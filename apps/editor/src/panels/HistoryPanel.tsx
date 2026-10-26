import { useState } from 'react';
import { Icon } from '../components/Icon';
import { useT } from '../i18n';
import { deleteSnapshot, renameSnapshot, restoreSnapshot, takeSnapshot, useSnapshots } from '../snapshots';
import { editor, useEditor } from '../store';

export function HistoryPanel() {
  const t = useT();
  const { history, historyIndex } = useEditor();
  return (
    <div className="panel-body">
      <ol className="history" aria-label={t('studio.history')}>
        {history.map((label, i) => (
          <li key={i}>
            <button
              className={`history-item${i === historyIndex ? ' on' : ''}${i > historyIndex ? ' future' : ''}`}
              aria-current={i === historyIndex ? 'step' : undefined}
              onClick={() => editor.goTo(i)}
            >
              {t(label)}
            </button>
          </li>
        ))}
      </ol>
      <Snapshots />
    </div>
  );
}

/** Instantanés : états du document gardés sous un nom (clic pour y revenir). */
function Snapshots() {
  const t = useT();
  const snaps = useSnapshots();
  const [editing, setEditing] = useState<number | null>(null);
  return (
    <>
      <div className="panel-sub">
        <span className="panel-sub-title">{t('snapshot.title')}</span>
        <button
          className="icon-btn"
          title={t('snapshot.new')}
          aria-label={t('snapshot.new')}
          data-testid="snapshot-add"
          onClick={() => takeSnapshot()}
        >
          <Icon name="plus" size={14} />
        </button>
      </div>
      {snaps.length === 0 && <p className="muted">{t('snapshot.empty')}</p>}
      <ul className="history" aria-label={t('snapshot.title')}>
        {snaps.map((s) => (
          <li key={s.id} className="snapshot-row">
            {editing === s.id ? (
              <input
                autoFocus
                className="snapshot-name"
                aria-label={t('snapshot.rename')}
                defaultValue={s.name}
                onBlur={(e) => {
                  if (e.currentTarget.value.trim()) renameSnapshot(s.id, e.currentTarget.value.trim());
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
                title={t('snapshot.restore')}
                data-testid={`snapshot-${s.id}`}
                onClick={() => restoreSnapshot(s.id)}
              >
                {s.name}
              </button>
            )}
            <button
              className="icon-btn"
              title={t('snapshot.rename')}
              aria-label={t('snapshot.rename')}
              onClick={() => setEditing(s.id)}
            >
              <Icon name="text" size={14} />
            </button>
            <button
              className="icon-btn"
              title={t('snapshot.delete')}
              aria-label={t('snapshot.delete')}
              onClick={() => deleteSnapshot(s.id)}
            >
              <Icon name="trash" size={14} />
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
