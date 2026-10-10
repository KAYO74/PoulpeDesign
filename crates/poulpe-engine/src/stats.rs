//! Mesure des performances : durée des dernières opérations de chaque sorte (profilage).

use std::collections::{HashMap, VecDeque};

const KEEP: usize = 120;

#[derive(Debug, Default, Clone, serde::Serialize)]
pub struct Summary {
    pub count: usize,
    pub mean_ms: f64,
    pub max_ms: f64,
    pub last_ms: f64,
}

/// Durées des `KEEP` dernières mesures, par nom d'opération.
#[derive(Default)]
pub struct Profiler {
    samples: HashMap<String, VecDeque<f64>>,
}

impl Profiler {
    pub fn record(&mut self, name: &str, ms: f64) {
        let q = self.samples.entry(name.to_string()).or_default();
        if q.len() == KEEP {
            q.pop_front();
        }
        q.push_back(ms);
    }

    pub fn summary(&self) -> HashMap<String, Summary> {
        self.samples
            .iter()
            .map(|(k, q)| {
                let count = q.len();
                let sum: f64 = q.iter().sum();
                let max = q.iter().cloned().fold(0.0, f64::max);
                let last = q.back().cloned().unwrap_or(0.0);
                (
                    k.clone(),
                    Summary {
                        count,
                        mean_ms: if count > 0 { sum / count as f64 } else { 0.0 },
                        max_ms: max,
                        last_ms: last,
                    },
                )
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn moyenne_et_maximum() {
        let mut p = Profiler::default();
        for ms in [1.0, 3.0, 2.0] {
            p.record("flou", ms);
        }
        let s = &p.summary()["flou"];
        assert_eq!(
            (s.count, s.mean_ms, s.max_ms, s.last_ms),
            (3, 2.0, 3.0, 2.0)
        );
        for _ in 0..500 {
            p.record("flou", 1.0);
        }
        assert_eq!(p.summary()["flou"].count, KEEP);
    }
}
