//! Calcul sur la carte graphique, via wgpu : Vulkan (Linux, Windows), Metal (macOS), DirectX 12
//! (Windows) ou OpenGL en dernier recours. Cartes NVIDIA, AMD, Intel et Apple Silicon.
//!
//! - Choix de la carte : automatique (la carte dédiée si elle existe, sinon la carte intégrée),
//!   dédiée, intégrée, ou aucune (calcul sur le processeur, sur tous les cœurs).
//! - Mémoire vidéo : les images sont traitées par tuiles dont la taille respecte la limite
//!   choisie dans les Préférences et les limites de la carte.
//! - Si la carte graphique échoue (pilote, mémoire), le calcul se refait sur le processeur.

use std::sync::mpsc;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use wgpu::util::DeviceExt;

use crate::adjust::{self, channel_tables, Adjustment, Options};
use crate::blur;
use crate::tiles;

/// Carte graphique voulue (Préférences > Performances).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum GpuChoice {
    #[default]
    Auto,
    Discrete,
    Integrated,
    /// Pas de carte graphique : tout sur le processeur.
    Cpu,
}

/// Interface graphique du système.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BackendChoice {
    #[default]
    Auto,
    Vulkan,
    Metal,
    Dx12,
    Gl,
}

impl BackendChoice {
    fn backends(self) -> wgpu::Backends {
        match self {
            BackendChoice::Auto => wgpu::Backends::PRIMARY,
            BackendChoice::Vulkan => wgpu::Backends::VULKAN,
            BackendChoice::Metal => wgpu::Backends::METAL,
            BackendChoice::Dx12 => wgpu::Backends::DX12,
            BackendChoice::Gl => wgpu::Backends::GL,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct GpuSettings {
    pub device: GpuChoice,
    pub backend: BackendChoice,
    /// Mémoire vidéo que le moteur s'autorise, en Mo.
    pub vram_mb: u64,
}

impl Default for GpuSettings {
    fn default() -> Self {
        GpuSettings {
            device: GpuChoice::Auto,
            backend: BackendChoice::Auto,
            vram_mb: 1024,
        }
    }
}

/// Une carte graphique trouvée, telle que les Préférences l'affichent.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterSummary {
    pub name: String,
    /// "discrete", "integrated", "cpu", "virtual" ou "other".
    pub kind: &'static str,
    /// "vulkan", "metal", "dx12", "gl"…
    pub backend: String,
    pub driver: String,
}

fn kind_of(t: wgpu::DeviceType) -> &'static str {
    match t {
        wgpu::DeviceType::DiscreteGpu => "discrete",
        wgpu::DeviceType::IntegratedGpu => "integrated",
        wgpu::DeviceType::Cpu => "cpu",
        wgpu::DeviceType::VirtualGpu => "virtual",
        wgpu::DeviceType::Other => "other",
    }
}

fn summary(a: &wgpu::Adapter) -> AdapterSummary {
    let info = a.get_info();
    AdapterSummary {
        name: info.name,
        kind: kind_of(info.device_type),
        backend: format!("{:?}", info.backend).to_lowercase(),
        driver: [info.driver, info.driver_info].join(" ").trim().to_string(),
    }
}

fn instance(backend: BackendChoice) -> wgpu::Instance {
    let mut desc = wgpu::InstanceDescriptor::new_without_display_handle();
    desc.backends = backend.backends();
    wgpu::Instance::new(desc)
}

/// Cartes graphiques utilisables avec cette interface graphique.
pub fn list_adapters(backend: BackendChoice) -> Vec<AdapterSummary> {
    pollster::block_on(instance(backend).enumerate_adapters(backend.backends()))
        .iter()
        .map(summary)
        .collect()
}

/// Rang d'une carte pour le choix voulu (plus petit = préféré) ; None si elle ne convient pas.
fn rank(choice: GpuChoice, t: wgpu::DeviceType) -> Option<u8> {
    use wgpu::DeviceType::*;
    let order: &[wgpu::DeviceType] = match choice {
        GpuChoice::Cpu => return None,
        // Une « carte » logicielle (llvmpipe, WARP) est plus lente que le calcul sur tous les
        // cœurs : elle n'est jamais choisie.
        GpuChoice::Auto | GpuChoice::Discrete => &[DiscreteGpu, IntegratedGpu, VirtualGpu, Other],
        GpuChoice::Integrated => &[IntegratedGpu, DiscreteGpu, VirtualGpu, Other],
    };
    order.iter().position(|o| *o == t).map(|p| p as u8)
}

const SHADER: &str = r#"
struct Params { count: u32, width: u32, height: u32, radius: u32 };

@group(0) @binding(0) var<uniform> p: Params;
@group(0) @binding(1) var<storage, read_write> px: array<u32>;
@group(0) @binding(2) var<storage, read> tables: array<u32>;
@group(0) @binding(3) var<storage, read_write> fa: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read_write> fb: array<vec4<f32>>;

fn unpack(v: u32) -> vec4<u32> {
    return vec4<u32>(v & 255u, (v >> 8u) & 255u, (v >> 16u) & 255u, v >> 24u);
}

// Tables par canal (niveaux, courbes, exposition…) : résultat identique au processeur.
@compute @workgroup_size(256)
fn apply_tables(@builtin(global_invocation_id) id: vec3<u32>) {
    let i = id.x + id.y * 65535u * 256u;
    if (i >= p.count) { return; }
    let c = unpack(px[i]);
    px[i] = tables[c.x] | (tables[256u + c.y] << 8u) | (tables[512u + c.z] << 16u) | (c.w << 24u);
}

// Flou : pixels → valeurs flottantes, alpha prémultiplié.
@compute @workgroup_size(256)
fn to_float(@builtin(global_invocation_id) id: vec3<u32>) {
    let i = id.x + id.y * 65535u * 256u;
    if (i >= p.count) { return; }
    let c = vec4<f32>(unpack(px[i]));
    let a = c.w / 255.0;
    fa[i] = vec4<f32>(c.xyz * a, c.w);
}

// Flou en boîte d'une ligne (fa → fb), les bords prolongent le premier et le dernier pixel.
@compute @workgroup_size(64)
fn box_rows(@builtin(global_invocation_id) id: vec3<u32>) {
    let y = id.x;
    if (y >= p.height) { return; }
    let w = p.width;
    let r = p.radius;
    let row = y * w;
    let k = 1.0 / f32(2u * r + 1u);
    let first = fa[row];
    let last = fa[row + w - 1u];
    var acc = first * f32(r + 1u);
    for (var x = 0u; x < r; x++) { acc += fa[row + min(x, w - 1u)]; }
    for (var x = 0u; x < w; x++) {
        var add = last;
        if (x + r < w) { add = fa[row + x + r]; }
        var sub = first;
        if (x >= r + 1u) { sub = fa[row + x - r - 1u]; }
        acc += add - sub;
        fb[row + x] = acc * k;
    }
}

// Même chose sur les colonnes (fb → fa).
@compute @workgroup_size(64)
fn box_cols(@builtin(global_invocation_id) id: vec3<u32>) {
    let x = id.x;
    if (x >= p.width) { return; }
    let w = p.width;
    let h = p.height;
    let r = p.radius;
    let k = 1.0 / f32(2u * r + 1u);
    let first = fb[x];
    let last = fb[(h - 1u) * w + x];
    var acc = first * f32(r + 1u);
    for (var y = 0u; y < r; y++) { acc += fb[min(y, h - 1u) * w + x]; }
    for (var y = 0u; y < h; y++) {
        var add = last;
        if (y + r < h) { add = fb[(y + r) * w + x]; }
        var sub = first;
        if (y >= r + 1u) { sub = fb[(y - r - 1u) * w + x]; }
        acc += add - sub;
        fa[y * w + x] = acc * k;
    }
}

// Valeurs flottantes → pixels (alpha « déprémultiplié »).
@compute @workgroup_size(256)
fn to_bytes(@builtin(global_invocation_id) id: vec3<u32>) {
    let i = id.x + id.y * 65535u * 256u;
    if (i >= p.count) { return; }
    let v = fa[i];
    let a = clamp(round(v.w), 0.0, 255.0);
    var rgb = vec3<f32>(0.0);
    if (v.w > 0.001) { rgb = clamp(round(v.xyz * (255.0 / v.w)), vec3<f32>(0.0), vec3<f32>(255.0)); }
    let o = vec4<u32>(vec4<f32>(rgb, a));
    px[i] = o.x | (o.y << 8u) | (o.z << 16u) | (o.w << 24u);
}
"#;

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct Params {
    count: u32,
    width: u32,
    height: u32,
    radius: u32,
}

/// Carte graphique prête à calculer.
pub struct Gpu {
    device: wgpu::Device,
    queue: wgpu::Queue,
    layout: wgpu::BindGroupLayout,
    tables: wgpu::ComputePipeline,
    to_float: wgpu::ComputePipeline,
    box_rows: wgpu::ComputePipeline,
    box_cols: wgpu::ComputePipeline,
    to_bytes: wgpu::ComputePipeline,
    pub adapter: AdapterSummary,
    /// Plus grand nombre de pixels d'une tuile (mémoire vidéo et limites de la carte).
    max_tile_pixels: u64,
    max_side: usize,
}

impl Gpu {
    /// Ouvre la carte graphique voulue. None si aucune ne convient (ou si « processeur » est
    /// choisi) : le moteur calcule alors sur le processeur.
    pub fn open(settings: &GpuSettings) -> Option<Gpu> {
        if settings.device == GpuChoice::Cpu {
            return None;
        }
        let inst = instance(settings.backend);
        let mut adapters = pollster::block_on(inst.enumerate_adapters(settings.backend.backends()));
        adapters.retain(|a| rank(settings.device, a.get_info().device_type).is_some());
        adapters.sort_by_key(|a| rank(settings.device, a.get_info().device_type));
        for adapter in adapters {
            if let Some(gpu) = Self::with_adapter(&adapter, settings.vram_mb) {
                return Some(gpu);
            }
        }
        None
    }

    fn with_adapter(adapter: &wgpu::Adapter, vram_mb: u64) -> Option<Gpu> {
        let limits = adapter.limits();
        let required = wgpu::Limits {
            max_storage_buffer_binding_size: limits.max_storage_buffer_binding_size,
            max_buffer_size: limits.max_buffer_size,
            max_storage_buffers_per_shader_stage: 4,
            ..wgpu::Limits::downlevel_defaults()
        };
        let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
            label: Some("poulpe-engine"),
            required_limits: required,
            memory_hints: wgpu::MemoryHints::MemoryUsage,
            ..Default::default()
        }))
        .ok()?;
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("poulpe-engine"),
            source: wgpu::ShaderSource::Wgsl(SHADER.into()),
        });
        let storage = |binding, read_only| wgpu::BindGroupLayoutEntry {
            binding,
            visibility: wgpu::ShaderStages::COMPUTE,
            ty: wgpu::BindingType::Buffer {
                ty: wgpu::BufferBindingType::Storage { read_only },
                has_dynamic_offset: false,
                min_binding_size: None,
            },
            count: None,
        };
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: None,
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                storage(1, false),
                storage(2, true),
                storage(3, false),
                storage(4, false),
            ],
        });
        let pl = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: None,
            bind_group_layouts: &[Some(&layout)],
            immediate_size: 0,
        });
        let pipeline = |entry: &str| {
            device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                label: Some(entry),
                layout: Some(&pl),
                module: &module,
                entry_point: Some(entry),
                compilation_options: Default::default(),
                cache: None,
            })
        };
        // Le flou garde deux images flottantes (16 octets par pixel chacune) et les pixels (4).
        let per_px = 36u64;
        let budget = (vram_mb.max(64) << 20).min(limits.max_buffer_size);
        let binding = limits.max_storage_buffer_binding_size as u64;
        let max_tile_pixels = (budget / per_px).min(binding / 16);
        Some(Gpu {
            tables: pipeline("apply_tables"),
            to_float: pipeline("to_float"),
            box_rows: pipeline("box_rows"),
            box_cols: pipeline("box_cols"),
            to_bytes: pipeline("to_bytes"),
            device,
            queue,
            layout,
            adapter: summary(adapter),
            max_tile_pixels,
            max_side: limits.max_texture_dimension_2d as usize,
        })
    }

    /// Côté des tuiles traitées d'un coup.
    pub fn tile_side(&self) -> usize {
        tiles::tile_side(self.max_tile_pixels * 4, 4, self.max_side.max(4096))
    }

    /// Ce que la carte graphique sait calculer (le reste se fait sur le processeur).
    pub fn supports(adj: &Adjustment) -> bool {
        channel_tables(adj).is_some() || matches!(adj, Adjustment::GaussianBlur { .. })
    }

    /// Applique le réglage sur la carte graphique, par tuiles. Faux si le réglage n'est pas pris
    /// en charge ou si la carte a échoué (l'image n'est alors pas modifiée).
    pub fn apply(
        &self,
        data: &mut [u8],
        w: usize,
        h: usize,
        adj: &Adjustment,
        opts: &Options,
    ) -> bool {
        if let Some(t) = channel_tables(adj) {
            let flat: Vec<u32> = t.iter().flat_map(|c| c.iter().map(|v| *v as u32)).collect();
            return self.tiled(data, w, h, 0, |tile, tw, th| {
                self.run_tables(tile, tw, th, &flat)
            });
        }
        if let Adjustment::GaussianBlur { radius } = adj {
            let sigma = (radius * opts.scale) / 2.0;
            if sigma < 0.3 {
                return true;
            }
            let radii: Vec<u32> = blur::box_sizes(sigma)
                .iter()
                .filter(|r| **r >= 1.0)
                .map(|r| *r as u32)
                .collect();
            return self.tiled(data, w, h, blur::reach(sigma), |tile, tw, th| {
                self.run_blur(tile, tw, th, &radii)
            });
        }
        false
    }

    fn tiled(
        &self,
        data: &mut [u8],
        w: usize,
        h: usize,
        halo: usize,
        run: impl Fn(&mut [u8], usize, usize) -> bool,
    ) -> bool {
        let side = self.tile_side().saturating_sub(2 * halo).max(256);
        let plan = tiles::plan(w, h, side, halo);
        if plan.len() == 1 {
            return run(data, w, h);
        }
        let mut out = data.to_vec();
        for t in &plan {
            let mut tile = tiles::extract(data, w, t.read);
            if !run(&mut tile, t.read.w, t.read.h) {
                return false;
            }
            tiles::put(&mut out, w, &tile, t);
        }
        data.copy_from_slice(&out);
        true
    }

    fn bind(
        &self,
        params: Params,
        px: &wgpu::Buffer,
        tables: &wgpu::Buffer,
        fa: &wgpu::Buffer,
        fb: &wgpu::Buffer,
    ) -> wgpu::BindGroup {
        let uniform = self
            .device
            .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: None,
                contents: bytemuck::bytes_of(&params),
                usage: wgpu::BufferUsages::UNIFORM,
            });
        self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: None,
            layout: &self.layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: uniform.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: px.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: tables.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 3,
                    resource: fa.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 4,
                    resource: fb.as_entire_binding(),
                },
            ],
        })
    }

    fn storage(&self, size: u64) -> wgpu::Buffer {
        self.device.create_buffer(&wgpu::BufferDescriptor {
            label: None,
            size: size.max(16),
            usage: wgpu::BufferUsages::STORAGE,
            mapped_at_creation: false,
        })
    }

    fn pixels(&self, data: &[u8]) -> wgpu::Buffer {
        self.device
            .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: None,
                contents: data,
                usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC,
            })
    }

    /// Groupes de travail pour `n` éléments (au plus 65 535 par dimension).
    fn groups(n: u32, size: u32) -> (u32, u32) {
        let g = n.div_ceil(size);
        if g <= 65535 {
            (g, 1)
        } else {
            (65535, g.div_ceil(65535))
        }
    }

    fn run_tables(&self, data: &mut [u8], w: usize, h: usize, flat: &[u32]) -> bool {
        let count = (w * h) as u32;
        let px = self.pixels(data);
        let tables = self
            .device
            .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: None,
                contents: bytemuck::cast_slice(flat),
                usage: wgpu::BufferUsages::STORAGE,
            });
        let dummy = self.storage(16);
        let bg = self.bind(
            Params {
                count,
                width: w as u32,
                height: h as u32,
                radius: 0,
            },
            &px,
            &tables,
            &dummy,
            &dummy,
        );
        let mut enc = self.device.create_command_encoder(&Default::default());
        {
            let mut pass = enc.begin_compute_pass(&Default::default());
            pass.set_pipeline(&self.tables);
            pass.set_bind_group(0, &bg, &[]);
            let (x, y) = Self::groups(count, 256);
            pass.dispatch_workgroups(x, y, 1);
        }
        self.read_back(enc, &px, data)
    }

    fn run_blur(&self, data: &mut [u8], w: usize, h: usize, radii: &[u32]) -> bool {
        let count = (w * h) as u32;
        let px = self.pixels(data);
        let fa = self.storage(w as u64 * h as u64 * 16);
        let fb = self.storage(w as u64 * h as u64 * 16);
        let dummy = self.storage(16);
        let mut enc = self.device.create_command_encoder(&Default::default());
        let params = |radius: u32| Params {
            count,
            width: w as u32,
            height: h as u32,
            radius,
        };
        {
            let bg = self.bind(params(0), &px, &dummy, &fa, &fb);
            let mut pass = enc.begin_compute_pass(&Default::default());
            pass.set_bind_group(0, &bg, &[]);
            pass.set_pipeline(&self.to_float);
            let (x, y) = Self::groups(count, 256);
            pass.dispatch_workgroups(x, y, 1);
            for &r in radii {
                let bg = self.bind(params(r.min(w as u32)), &px, &dummy, &fa, &fb);
                pass.set_bind_group(0, &bg, &[]);
                pass.set_pipeline(&self.box_rows);
                pass.dispatch_workgroups((h as u32).div_ceil(64), 1, 1);
                let bg = self.bind(params(r.min(h as u32)), &px, &dummy, &fa, &fb);
                pass.set_bind_group(0, &bg, &[]);
                pass.set_pipeline(&self.box_cols);
                pass.dispatch_workgroups((w as u32).div_ceil(64), 1, 1);
            }
            let bg = self.bind(params(0), &px, &dummy, &fa, &fb);
            pass.set_bind_group(0, &bg, &[]);
            pass.set_pipeline(&self.to_bytes);
            pass.dispatch_workgroups(x, y, 1);
        }
        self.read_back(enc, &px, data)
    }

    fn read_back(&self, mut enc: wgpu::CommandEncoder, px: &wgpu::Buffer, data: &mut [u8]) -> bool {
        let size = data.len() as u64;
        let staging = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: None,
            size,
            usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        enc.copy_buffer_to_buffer(px, 0, &staging, 0, size);
        self.queue.submit([enc.finish()]);
        let (tx, rx) = mpsc::channel();
        staging.slice(..).map_async(wgpu::MapMode::Read, move |r| {
            let _ = tx.send(r.is_ok());
        });
        if self
            .device
            .poll(wgpu::PollType::wait_indefinitely())
            .is_err()
            || rx.recv() != Ok(true)
        {
            return false;
        }
        let ok = match staging.slice(..).get_mapped_range() {
            Ok(view) => {
                data.copy_from_slice(&view);
                true
            }
            Err(_) => false,
        };
        staging.unmap();
        ok
    }
}

/// Où un calcul a été fait.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Where {
    Gpu,
    Cpu,
}

/// Applique le réglage : sur la carte graphique si elle le sait et que l'image est assez grande
/// pour que l'aller-retour en vaille la peine, sinon (ou si elle échoue) sur tous les cœurs du
/// processeur. Renvoie où le calcul a été fait et sa durée en millisecondes.
pub fn apply(
    gpu: Option<&Gpu>,
    data: &mut [u8],
    w: usize,
    h: usize,
    adj: &Adjustment,
    opts: &Options,
) -> (Where, f64) {
    let t0 = Instant::now();
    if let Some(gpu) = gpu {
        if w * h >= 1 << 20 && Gpu::supports(adj) && gpu.apply(data, w, h, adj, opts) {
            return (Where::Gpu, t0.elapsed().as_secs_f64() * 1000.0);
        }
    }
    adjust::apply(data, w, h, adj, opts);
    (Where::Cpu, t0.elapsed().as_secs_f64() * 1000.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn image(w: usize, h: usize) -> Vec<u8> {
        let mut s: u32 = 7;
        (0..w * h)
            .flat_map(|i| {
                s = s.wrapping_mul(1103515245).wrapping_add(12345);
                let (x, y) = (i % w, i / w);
                [
                    (x * 255 / w) as u8,
                    (y * 255 / h) as u8,
                    (s >> 24) as u8,
                    if x < 5 { 0 } else { 255 },
                ]
            })
            .collect()
    }

    /// La carte du poste, ou à défaut la carte logicielle (llvmpipe) pour vérifier les calculs.
    fn gpu() -> Option<Gpu> {
        let g = Gpu::open(&GpuSettings::default()).or_else(|| {
            let inst = instance(BackendChoice::Auto);
            let all = pollster::block_on(inst.enumerate_adapters(wgpu::Backends::PRIMARY));
            all.iter().find_map(|a| Gpu::with_adapter(a, 1024))
        });
        if g.is_none() {
            eprintln!("pas de carte graphique (ni logicielle) : test passé");
        }
        g
    }

    #[test]
    fn choix_de_la_carte() {
        use wgpu::DeviceType::*;
        assert!(rank(GpuChoice::Auto, DiscreteGpu) < rank(GpuChoice::Auto, IntegratedGpu));
        assert!(
            rank(GpuChoice::Integrated, IntegratedGpu) < rank(GpuChoice::Integrated, DiscreteGpu)
        );
        assert_eq!(rank(GpuChoice::Auto, Cpu), None);
        assert_eq!(rank(GpuChoice::Cpu, DiscreteGpu), None);
        assert!(Gpu::open(&GpuSettings {
            device: GpuChoice::Cpu,
            ..Default::default()
        })
        .is_none());
        let s: GpuSettings =
            serde_json::from_str(r#"{"device":"discrete","backend":"dx12","vramMb":512}"#).unwrap();
        assert_eq!(
            (s.device, s.backend, s.vram_mb),
            (GpuChoice::Discrete, BackendChoice::Dx12, 512)
        );
    }

    #[test]
    fn tables_identiques_au_processeur() {
        let Some(gpu) = gpu() else { return };
        let (w, h) = (613, 411);
        let src = image(w, h);
        let adj: Adjustment = serde_json::from_str(
            r#"{"kind":"levels","black":20,"white":230,"gamma":1.4,"outBlack":10,"outWhite":240}"#,
        )
        .unwrap();
        let mut cpu = src.clone();
        adjust::apply(&mut cpu, w, h, &adj, &Options::default());
        let mut g = src.clone();
        assert!(gpu.apply(&mut g, w, h, &adj, &Options::default()));
        assert_eq!(g, cpu);
    }

    #[test]
    fn flou_proche_du_processeur_meme_en_tuiles() {
        let Some(mut gpu) = gpu() else { return };
        let (w, h) = (700, 530);
        let src = image(w, h);
        let adj = Adjustment::GaussianBlur { radius: 12.0 };
        let mut cpu = src.clone();
        adjust::apply(&mut cpu, w, h, &adj, &Options::default());
        for tile_px in [u64::MAX, 300 * 300] {
            gpu.max_tile_pixels = tile_px.min(gpu.max_tile_pixels);
            let mut g = src.clone();
            assert!(gpu.apply(&mut g, w, h, &adj, &Options::default()));
            let worst = g
                .iter()
                .zip(&cpu)
                .map(|(a, b)| (*a as i32 - *b as i32).abs())
                .max()
                .unwrap();
            assert!(worst <= 1, "écart de {worst}");
        }
    }
}
