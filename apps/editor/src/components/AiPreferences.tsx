import { useEffect, useState } from 'react';
import { listModels } from '../ai/client';
import {
  AI_PRESETS,
  addProvider,
  hasKey,
  removeProvider,
  saveKey,
  setDefault,
  updateProvider,
  useAi,
  type AiProvider,
} from '../ai/providers';
import { useT } from '../i18n';
import { isDesktop } from '../io';
import { toast } from '../store';
import { Select } from './fields';

/** Préférences › IA : fournisseurs connectés, clés API et IA utilisées par défaut. */
export function AiPane() {
  const t = useT();
  const ai = useAi();
  const [preset, setPreset] = useState(AI_PRESETS[0].id);
  const none = { value: '', label: t('ai.noneOption') };
  return (
    <>
      <section className="prefs-section">
        <h3>{t('ai.providers')}</h3>
        <p className="muted">
          {t('ai.intro')} {isDesktop() ? t('ai.keyDesktop') : t('ai.keyBrowser')}
        </p>
        <div className="row-buttons">
          <Select
            testId="ai-preset"
            value={preset}
            options={AI_PRESETS.map((p) => ({
              value: p.id,
              label: p.local ? `${p.name} (${t('ai.local')})` : p.name,
            }))}
            onChange={setPreset}
          />
          <button
            className="btn"
            data-testid="ai-add"
            onClick={() => addProvider(AI_PRESETS.find((p) => p.id === preset)!)}
          >
            {t('ai.add')}
          </button>
        </div>
        {ai.providers.length === 0 && <p className="muted">{t('ai.none')}</p>}
        {ai.providers.map((p) => (
          <ProviderCard key={p.id} p={p} />
        ))}
      </section>
      {ai.providers.length > 0 && (
        <section className="prefs-section">
          <div className="prefs-grid">
            <Select
              label={t('ai.defaultText')}
              value={ai.textId ?? ''}
              options={[none, ...ai.providers.map((p) => ({ value: p.id, label: p.name }))]}
              onChange={(v) => setDefault('textId', v)}
            />
            <Select
              label={t('ai.defaultImage')}
              value={ai.imageId ?? ''}
              options={[
                none,
                ...ai.providers.filter((p) => p.imageModel).map((p) => ({ value: p.id, label: p.name })),
              ]}
              onChange={(v) => setDefault('imageId', v)}
            />
          </div>
        </section>
      )}
    </>
  );
}

function TextField({
  label,
  value,
  onChange,
  list,
  testId,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  list?: string;
  testId?: string;
}) {
  return (
    <label className="ws-name">
      <span>{label}</span>
      <input
        className="text-input"
        value={value}
        list={list}
        data-testid={testId}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function ProviderCard({ p }: { p: AiProvider }) {
  const t = useT();
  const [key, setKey] = useState('');
  const [saved, setSaved] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void hasKey(p.id).then(setSaved);
  }, [p.id]);
  const set = (patch: Partial<AiProvider>) => updateProvider(p.id, patch);
  const storeKey = async () => {
    try {
      await saveKey(p, key.trim());
      setKey('');
      setSaved(true);
    } catch (e) {
      toast(t('ai.error', { msg: String(e) }));
    }
  };
  const test = async () => {
    setBusy(true);
    try {
      const list = await listModels(p);
      setModels(list);
      if (!p.model && list[0]) set({ model: list[0] });
      toast(t('ai.testOk', { n: list.length }));
    } catch (e) {
      toast(t('ai.error', { msg: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  };
  const listId = `ai-models-${p.id}`;
  return (
    <div className="ai-card" data-testid="ai-card">
      <div className="prefs-grid">
        <TextField label={t('ai.name')} value={p.name} onChange={(name) => set({ name })} />
        <TextField
          label={t('ai.url')}
          value={p.baseUrl}
          onChange={(baseUrl) => set({ baseUrl })}
          testId="ai-url"
        />
        <TextField
          label={t('ai.model')}
          value={p.model}
          onChange={(model) => set({ model })}
          list={listId}
          testId="ai-model"
        />
        {p.kind !== 'anthropic' && (
          <TextField
            label={t('ai.imageModel')}
            value={p.imageModel}
            onChange={(imageModel) => set({ imageModel })}
            list={listId}
          />
        )}
      </div>
      <datalist id={listId}>
        {models.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      <div className="row-buttons">
        <input
          className="text-input"
          type="password"
          autoComplete="off"
          aria-label={t('ai.key')}
          data-testid="ai-key"
          value={key}
          placeholder={
            saved
              ? `${t('ai.key')} : ${t('ai.keySaved')}`
              : `${t('ai.key')}${p.local ? ` (${t('ai.keyOptional')})` : ''}`
          }
          onChange={(e) => setKey(e.target.value)}
        />
        <button className="btn" disabled={!key.trim()} onClick={() => void storeKey()}>
          {t('ai.saveKey')}
        </button>
        <button className="btn" data-testid="ai-test" disabled={busy} onClick={() => void test()}>
          {t('ai.test')}
        </button>
        <button className="btn danger" onClick={() => removeProvider(p.id)}>
          {t('ai.remove')}
        </button>
      </div>
    </div>
  );
}
