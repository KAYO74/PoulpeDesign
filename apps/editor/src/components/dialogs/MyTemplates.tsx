import { useEffect, useMemo } from 'react';
import { useT } from '../../i18n';
import { ui } from '../../store';
import {
  deleteUserTemplate,
  exportUserTemplate,
  importUserTemplate,
  newFromUserTemplate,
  useUserTemplates,
  type UserTemplate,
} from '../../userTemplates';
import { Icon } from '../Icon';

/** « Mes modèles » dans l'écran d'accueil : modèles enregistrés par l'utilisateur. */
export function MyTemplates() {
  const t = useT();
  const list = useUserTemplates();
  return (
    <>
      <div className="chips mytpl-bar" role="group">
        <button
          className="chip-btn"
          data-testid="mytpl-save"
          onClick={() => ui.set({ dialog: 'saveTemplate' })}
        >
          <Icon name="plus" />
          {t('mytpl.saveCurrent')}
        </button>
        <button className="chip-btn" data-testid="mytpl-import" onClick={() => void importUserTemplate()}>
          <Icon name="import" />
          {t('mytpl.import')}
        </button>
      </div>
      {list && !list.length && <p className="note">{t('mytpl.empty')}</p>}
      <div className="tpl-grid wide">
        {list?.map((d) => (
          <MyTemplateCard key={d.id} def={d} />
        ))}
      </div>
    </>
  );
}

function MyTemplateCard({ def }: { def: UserTemplate }) {
  const t = useT();
  const url = useMemo(
    () => (def.thumb ? URL.createObjectURL(new Blob([def.thumb as BlobPart], { type: 'image/png' })) : null),
    [def.thumb],
  );
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  return (
    <div className="tpl-card my-tpl" data-testid={`mytpl-${def.name}`}>
      <button className="tpl-card" title={def.name} onClick={() => void newFromUserTemplate(def)}>
        <span className="tpl-thumb">{url && <img className="thumb-img" src={url} alt={def.name} />}</span>
        <b>{def.name}</b>
        <span className="muted">
          {def.width} × {def.height}
        </span>
      </button>
      <span className="my-tpl-actions">
        <button
          className="icon-btn"
          title={t('mytpl.export')}
          aria-label={t('mytpl.export')}
          onClick={() => void exportUserTemplate(def)}
        >
          <Icon name="export" />
        </button>
        <button
          className="icon-btn"
          title={t('mytpl.delete')}
          aria-label={t('mytpl.delete')}
          onClick={() => void deleteUserTemplate(def)}
        >
          <Icon name="trash" />
        </button>
      </span>
    </div>
  );
}
