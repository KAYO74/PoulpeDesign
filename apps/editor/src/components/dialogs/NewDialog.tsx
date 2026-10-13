import { useState } from 'react';
import { FORMAT_PRESETS, findFormat, type FormatCategory } from '@poulpe/core';
import { TEMPLATES } from '@poulpe/library';
import { useT } from '../../i18n';
import { newDocument, openDocument, openPhoto } from '../../io';
import { newFromTemplate } from '../../libraryActions';
import { TemplateCard } from '../../panels/Library';
import { setSettings, useUi } from '../../store';
import { MyTemplates } from './MyTemplates';
import { NumberField } from '../fields';
import { Icon } from '../Icon';
import { Modal } from './Modal';
import { close } from './close';

type NewSection = 'templates' | 'mine' | FormatCategory;

/**
 * Écran d'accueil et « Nouveau document » : modèles prêts à l'emploi, formats par usage (réseaux
 * sociaux, impression, écran) et taille personnalisée.
 */
export function NewDialog() {
  const t = useT();
  const showWelcome = useUi((s) => s.settings.showWelcome);
  const [section, setSection] = useState<NewSection>('templates');
  const [preset, setPreset] = useState('portrait');
  const [size, setSize] = useState({ width: 1080, height: 1350 });
  const [format, setFormat] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(1);
  const [facing, setFacing] = useState(false);
  const print = section === 'print' || findFormat(preset)?.category === 'print';
  const create = (w: number, h: number, isPrint = print) =>
    newDocument(w, h, isPrint ? { dpi: 300, pages: pageCount, facing } : {});
  const formats =
    section === 'templates' || section === 'mine' ? [] : FORMAT_PRESETS.filter((f) => f.category === section);
  const templates = TEMPLATES.filter((d) => !format || d.format === format);
  const usedFormats = [...new Set(TEMPLATES.map((d) => d.format))];
  return (
    <Modal title={t('new.welcome')} onClose={close} xl>
      <div className="new-layout">
        <nav className="new-nav" aria-label={t('new.title')}>
          <button aria-pressed={section === 'templates'} onClick={() => setSection('templates')}>
            <Icon name="template" />
            {t('new.templates')}
          </button>
          <button aria-pressed={section === 'mine'} data-testid="new-mine" onClick={() => setSection('mine')}>
            <Icon name="styleSave" />
            {t('mytpl.title')}
          </button>
          <span className="new-nav-head">{t('new.formats')}</span>
          {(['social', 'print', 'screen'] as const).map((c) => (
            <button
              key={c}
              aria-pressed={section === c}
              data-testid={`new-${c}`}
              onClick={() => setSection(c)}
            >
              <Icon name={c === 'social' ? 'photo' : c === 'print' ? 'layout' : 'artboard'} />
              {t(`library.cat.${c}`)}
            </button>
          ))}
          <span className="spacer" />
          <button onClick={() => void openPhoto()} data-testid="welcome-open-photo">
            <Icon name="photo" />
            {t('new.openPhoto')}
          </button>
          <button onClick={() => void openDocument()}>
            <Icon name="folder" />
            {t('new.open')}
          </button>
        </nav>
        <div className="new-main">
          {section === 'mine' ? (
            <MyTemplates />
          ) : section === 'templates' ? (
            <>
              <div className="chips" role="group">
                <button className="chip-btn" aria-pressed={format === null} onClick={() => setFormat(null)}>
                  {t('library.all')}
                </button>
                {usedFormats.map((f) => (
                  <button
                    key={f}
                    className="chip-btn"
                    aria-pressed={format === f}
                    onClick={() => setFormat(f)}
                  >
                    {t(`format.${f}`)}
                  </button>
                ))}
              </div>
              <div className="tpl-grid wide">
                {templates.map((d) => (
                  <TemplateCard key={d.id} def={d} onPick={newFromTemplate} />
                ))}
              </div>
            </>
          ) : (
            <div className="preset-grid">
              {formats.map((f) => (
                <button
                  key={f.id}
                  className={`preset${preset === f.id ? ' on' : ''}`}
                  data-testid={`preset-${f.id}`}
                  onClick={() => {
                    setPreset(f.id);
                    setSize({ width: f.width, height: f.height });
                  }}
                  onDoubleClick={() => create(f.width, f.height, f.category === 'print')}
                >
                  <span className="preset-shape" style={{ aspectRatio: `${f.width} / ${f.height}` }} />
                  <b>{t(`format.${f.id}`)}</b>
                  <span className="num">
                    {f.width} × {f.height}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <footer className="new-footer">
        <label className="check">
          <input
            type="checkbox"
            checked={showWelcome}
            onChange={(e) => setSettings({ showWelcome: e.target.checked })}
          />
          {t('new.showAtStartup')}
        </label>
        <span className="spacer" />
        {print && (
          <>
            <NumberField
              label={t('new.pages')}
              value={pageCount}
              min={1}
              max={500}
              width={80}
              testId="new-pages"
              onChange={setPageCount}
            />
            <label className="check">
              <input type="checkbox" checked={facing} onChange={(e) => setFacing(e.target.checked)} />
              {t('docsetup.facing')}
            </label>
          </>
        )}
        <span className="muted">{t('new.custom2')}</span>
        <NumberField
          label={t('new.width')}
          value={size.width}
          min={1}
          max={20000}
          unit="px"
          width={120}
          onChange={(v) => (setPreset('custom'), setSize({ ...size, width: v }))}
        />
        <NumberField
          label={t('new.height')}
          value={size.height}
          min={1}
          max={20000}
          unit="px"
          width={120}
          onChange={(v) => (setPreset('custom'), setSize({ ...size, height: v }))}
        />
        <button
          className="btn primary"
          data-testid="new-create"
          onClick={() => create(size.width, size.height)}
        >
          {t('new.blank')}
        </button>
      </footer>
    </Modal>
  );
}
