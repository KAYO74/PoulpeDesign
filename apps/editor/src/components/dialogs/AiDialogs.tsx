import { useRef, useState } from 'react';
import { createText, findArtboard } from '@poulpe/core';
import { chat, generateImage, IMAGE_SIZES, type ChatMessage, type ImageSize } from '../../ai/client';
import { providerById, setDefault, useAi, type AiProvider } from '../../ai/providers';
import { useT } from '../../i18n';
import { placeImageBytes } from '../../io';
import { editor, toast, ui } from '../../store';
import { Select } from '../fields';
import { Modal } from './Modal';

const close = () => ui.set({ dialog: null });
const openSettings = () => ui.set({ dialog: 'preferences', prefsTab: 'ai' });

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Choix de l'IA en haut des fenêtres ; le choix devient celui par défaut. */
function ProviderPick({ which, list }: { which: 'textId' | 'imageId'; list: AiProvider[] }) {
  const t = useT();
  const ai = useAi();
  const current = providerById(ai[which])?.id ?? list[0]?.id ?? '';
  return (
    <Select
      label={t('ai.provider')}
      testId="ai-provider"
      value={current}
      options={list.map((p) => ({ value: p.id, label: p.name }))}
      onChange={(v) => setDefault(which, v)}
    />
  );
}

function NoProvider({ text }: { text: string }) {
  const t = useT();
  return (
    <>
      <p className="muted">{text}</p>
      <footer>
        <button className="btn" onClick={close}>
          {t('new.cancel')}
        </button>
        <button className="btn primary" onClick={openSettings}>
          {t('ai.settings')}
        </button>
      </footer>
    </>
  );
}

/** Ajoute la réponse de l'IA en cadre de texte au milieu de la page active. */
function insertText(text: string) {
  const doc = editor.doc;
  const ab = findArtboard(doc, editor.getState().activeArtboardId) ?? doc.artboards[0];
  if (!ab) return;
  const width = Math.round(ab.width * 0.8);
  const node = createText({
    x: ab.x + (ab.width - width) / 2,
    y: ab.y + ab.height / 4,
    width,
    height: Math.round(ab.height / 2),
    text,
    autoWidth: false,
    name: text.slice(0, 30),
  });
  editor.apply('history.add', (d) => {
    (findArtboard(d, ab.id) ?? d.artboards[0]).children.push(node);
    return [node.id];
  });
  ui.set({ tool: 'select' });
}

/** IA › Assistant IA : discussion avec l'IA choisie ; une réponse peut être placée dans le document. */
export function AiAssistantDialog() {
  const t = useT();
  const ai = useAi();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const log = useRef<HTMLDivElement>(null);
  const provider = providerById(ai.textId) ?? ai.providers[0];

  const send = async () => {
    const q = input.trim();
    if (!q || busy || !provider) return;
    const next: ChatMessage[] = [...messages, { role: 'user', content: q }];
    setMessages(next);
    setInput('');
    setBusy(true);
    try {
      const answer = await chat(provider, next);
      setMessages([...next, { role: 'assistant', content: answer }]);
    } catch (e) {
      toast(t('ai.error', { msg: errMsg(e) }));
    } finally {
      setBusy(false);
      requestAnimationFrame(() => log.current?.scrollTo({ top: log.current.scrollHeight }));
    }
  };

  return (
    <Modal title={t('ai.assistant').replace('…', '')} onClose={close} wide>
      {!provider ? (
        <NoProvider text={t('ai.needProvider')} />
      ) : (
        <>
          <ProviderPick which="textId" list={ai.providers} />
          <div className="ai-log" ref={log} data-testid="ai-log">
            {messages.map((m, i) => (
              <div key={i} className={`ai-msg ${m.role}`}>
                <div className="ai-text">{m.content}</div>
                {m.role === 'assistant' && (
                  <button className="btn small" data-testid="ai-insert" onClick={() => insertText(m.content)}>
                    {t('ai.insertText')}
                  </button>
                )}
              </div>
            ))}
            {busy && <div className="ai-msg assistant muted">{t('ai.thinking')}</div>}
          </div>
          <textarea
            className="text-input ai-input"
            data-testid="ai-input"
            value={input}
            placeholder={t('ai.ask')}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <footer>
            <button className="btn" disabled={!messages.length || busy} onClick={() => setMessages([])}>
              {t('ai.clear')}
            </button>
            <span className="spacer" />
            <button className="btn" onClick={close}>
              {t('common.close')}
            </button>
            <button
              className="btn primary"
              data-testid="ai-send"
              disabled={!input.trim() || busy}
              onClick={() => void send()}
            >
              {t('ai.send')}
            </button>
          </footer>
        </>
      )}
    </Modal>
  );
}

const SIZE_LABEL: Record<ImageSize, 'ai.size.square' | 'ai.size.landscape' | 'ai.size.portrait'> = {
  '1024x1024': 'ai.size.square',
  '1536x1024': 'ai.size.landscape',
  '1024x1536': 'ai.size.portrait',
};

/** IA › Générer une image : l'image créée est placée dans le document ouvert. */
export function AiImageDialog() {
  const t = useT();
  const ai = useAi();
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState<ImageSize>('1024x1024');
  const [busy, setBusy] = useState(false);
  const list = ai.providers.filter((p) => p.imageModel);
  const provider = providerById(ai.imageId)?.imageModel ? providerById(ai.imageId)! : list[0];

  const run = async () => {
    if (!prompt.trim() || busy || !provider) return;
    setBusy(true);
    try {
      const img = await generateImage(provider, prompt.trim(), size);
      await placeImageBytes(img.bytes, img.mime);
      toast(t('ai.generated'));
      close();
    } catch (e) {
      toast(t('ai.error', { msg: errMsg(e) }));
      setBusy(false);
    }
  };

  return (
    <Modal title={t('ai.image').replace('…', '')} onClose={close}>
      {!provider ? (
        <NoProvider text={ai.providers.length ? t('ai.needImageProvider') : t('ai.needProvider')} />
      ) : (
        <>
          <ProviderPick which="imageId" list={list} />
          <label className="ws-name">
            <span>{t('ai.prompt')}</span>
            <textarea
              className="text-input ai-input"
              data-testid="ai-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </label>
          <Select
            label={t('ai.size')}
            value={size}
            options={IMAGE_SIZES.map((s) => ({ value: s, label: t(SIZE_LABEL[s]) }))}
            onChange={setSize}
          />
          {busy && <p className="muted">{t('ai.generating')}</p>}
          <footer>
            <button className="btn" onClick={close}>
              {t('new.cancel')}
            </button>
            <button
              className="btn primary"
              data-testid="ai-generate"
              disabled={!prompt.trim() || busy}
              onClick={() => void run()}
            >
              {t('ai.generate')}
            </button>
          </footer>
        </>
      )}
    </Modal>
  );
}
