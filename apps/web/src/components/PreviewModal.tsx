import { useEffect, useState } from 'react';
import { Download, ExternalLink, FileQuestion, LoaderCircle, X } from 'lucide-react';
import { formatBytes, type Material } from '@csd/shared';
import { formatOf, previewKind } from '../lib/files';

export function PreviewModal({ material, onClose }: { material: Material; onClose: () => void }) {
  const kind = previewKind(material);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(kind === 'text');

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);

  useEffect(() => {
    if (kind !== 'text') return;
    const controller = new AbortController();
    fetch(material.downloadUrl, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then((value) => setText(value.slice(0, 750_000)))
      .catch((reason: Error) => { if (reason.name !== 'AbortError') setError('Текстовый файл не удалось открыть в браузере.'); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [kind, material.downloadUrl]);

  const officeUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(material.downloadUrl)}`;

  return (
    <div className="preview-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="preview-modal" role="dialog" aria-modal="true" aria-label={`Предпросмотр ${material.title}`}>
        <header className="preview-header">
          <div><span>{formatOf(material)} · {formatBytes(material.size)}</span><h3>{material.title}</h3></div>
          <div className="preview-actions">
            <a href={material.downloadUrl} target="_blank" rel="noreferrer"><Download /> Скачать</a>
            <button onClick={onClose} aria-label="Закрыть"><X /></button>
          </div>
        </header>
        <div className={`preview-stage ${kind}`}>
          {kind === 'image' && <img src={material.downloadUrl} alt={material.title} />}
          {kind === 'pdf' && <iframe src={material.downloadUrl} title={material.title} />}
          {kind === 'office' && <iframe src={officeUrl} title={material.title} />}
          {kind === 'text' && loading && <div className="preview-message"><LoaderCircle className="spin" /><p>Загружаем текст…</p></div>}
          {kind === 'text' && !loading && !error && <pre>{text}{text.length >= 750_000 ? '\n\n… предпросмотр ограничен 750 000 символов' : ''}</pre>}
          {(kind === 'unsupported' || error) && <div className="preview-message"><FileQuestion /><h4>Предпросмотр недоступен</h4><p>{error || `Формат ${formatOf(material)} можно скачать и открыть на устройстве.`}</p><a href={material.downloadUrl} target="_blank" rel="noreferrer"><ExternalLink /> Открыть файл</a></div>}
        </div>
        <footer className="preview-footer"><span>{material.course}</span><i /> <span>{material.subject}</span><i /> <span>{material.fileName}</span></footer>
      </section>
    </div>
  );
}
