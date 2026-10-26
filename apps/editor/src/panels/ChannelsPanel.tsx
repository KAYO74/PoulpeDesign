import { useEffect, useRef, useState } from 'react';
import type { AlphaChannel } from '@poulpe/core';
import { Icon } from '../components/Icon';
import { useT, type MessageKey } from '../i18n';
import {
  channelPreview,
  deleteChannel,
  loadChannel,
  modeFromKeys,
  renameChannel,
  saveSelectionAsChannel,
  selectFromColorChannel,
  type ColorChannel,
} from '../photo/channels';
import { renderBelow } from '../photo/photoActions';
import { images } from '../photo/pixels';
import { editor, useEditor, useUi } from '../store';

const COLOR_CHANNELS: { id: ColorChannel; label: MessageKey }[] = [
  { id: 'rgb', label: 'channels.rgb' },
  { id: 'r', label: 'channels.red' },
  { id: 'g', label: 'channels.green' },
  { id: 'b', label: 'channels.blue' },
];

/**
 * Panneau Couches : couches de couleur de l'image visible et couches alpha du document. Un clic
 * charge la couche comme sélection (Maj : ajouter, Alt : retirer, Maj+Alt : intersection).
 */
export function ChannelsPanel() {
  const t = useT();
  const { doc, activeArtboardId } = useEditor();
  const hasSelection = useUi((s) => s.hasPixelSelection);
  const [px, setPx] = useState<ImageData | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  useEffect(() => {
    const id = setTimeout(() => setPx(renderBelow(96)), 250);
    return () => clearTimeout(id);
  }, [doc, activeArtboardId]);
  return (
    <div className="panel-body">
      <ul className="channels" aria-label={t('studio.channels')}>
        {COLOR_CHANNELS.map((c) => (
          <li key={c.id} className="channel-row">
            <Thumb draw={(ctx) => px && ctx.drawImage(channelPreview(px, c.id), 0, 0, 32, 24)} deps={[px]} />
            <button
              className="history-item"
              title={t('channels.load')}
              data-testid={`channel-${c.id}`}
              onClick={(e) => selectFromColorChannel(c.id, modeFromKeys(e))}
            >
              {t(c.label)}
            </button>
          </li>
        ))}
        {(doc.channels ?? []).map((ch) => (
          <li key={ch.id} className="channel-row">
            <AlphaThumb channel={ch} />
            {editing === ch.id ? (
              <input
                autoFocus
                className="snapshot-name"
                aria-label={t('channels.rename')}
                defaultValue={ch.name}
                onBlur={(e) => {
                  const name = e.currentTarget.value.trim();
                  if (name && name !== ch.name) renameChannel(ch.id, name);
                  setEditing(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                  if (e.key === 'Escape') setEditing(null);
                }}
              />
            ) : (
              <button
                className="history-item"
                title={t('channels.load')}
                data-testid={`channel-${ch.id}`}
                onClick={(e) => loadChannel(ch, modeFromKeys(e))}
              >
                {ch.name}
              </button>
            )}
            <button
              className="icon-btn"
              title={t('channels.rename')}
              aria-label={t('channels.rename')}
              onClick={() => setEditing(ch.id)}
            >
              <Icon name="text" size={14} />
            </button>
            <button
              className="icon-btn"
              title={t('channels.delete')}
              aria-label={t('channels.delete')}
              onClick={() => deleteChannel(ch.id)}
            >
              <Icon name="trash" size={14} />
            </button>
          </li>
        ))}
      </ul>
      <div className="panel-sub">
        <span className="panel-sub-title">{t('channels.alpha')}</span>
        <button
          className="icon-btn"
          title={t('channels.save')}
          aria-label={t('channels.save')}
          data-testid="channel-save"
          disabled={!hasSelection}
          onClick={saveSelectionAsChannel}
        >
          <Icon name="plus" size={14} />
        </button>
      </div>
      {!doc.channels?.length && <p className="muted">{t('channels.empty')}</p>}
    </div>
  );
}

function Thumb({ draw, deps }: { draw: (ctx: CanvasRenderingContext2D) => void; deps: unknown[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 32, 24);
    draw(ctx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return <canvas ref={ref} className="channel-thumb" width={32} height={24} />;
}

/** Aperçu d'une couche alpha : blanc là où elle est opaque, sur fond noir. */
function AlphaThumb({ channel }: { channel: AlphaChannel }) {
  const img = images().get(editor.doc, channel.assetId);
  return (
    <Thumb
      deps={[img, channel.assetId]}
      draw={(ctx) => {
        if (!img) return;
        ctx.save();
        ctx.drawImage(img, 0, 0, 32, 24);
        ctx.globalCompositeOperation = 'source-in';
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, 32, 24);
        ctx.globalCompositeOperation = 'destination-over';
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, 32, 24);
        ctx.restore();
      }}
    />
  );
}
