import { useEffect } from 'react';
import { Download, ExternalLink, FileQuestion, FileText, X } from 'lucide-react';
import { formatBytes, type Material } from '@csd/shared';
import { externalDocumentUrl, formatOf, previewKind } from '../lib/files';

export function PreviewModal({ material, onClose }: { material: Material; onClose: () => void }) {
  const kind = previewKind(material);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);

  const officeUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(material.downloadUrl)}`;
  const documentUrl = externalDocumentUrl(material.downloadUrl);
  const imageUrl = `https://images.weserv.nl/?url=${encodeURIComponent(material.downloadUrl)}&output=webp`;
  const externalPreview = kind === 'pdf' || kind === 'text';

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
          {kind === 'image' && <img src={imageUrl} alt={material.title} />}
          {kind === 'office' && <iframe src={officeUrl} title={material.title} />}
          {externalPreview && (
            <div className="preview-message">
              <FileText />
              <h4>Предпросмотр готов</h4>
              <p>
                Firefox не разрешает встраивать просмотрщик Google в другие сайты.
                Откройте файл в отдельной вкладке — страница ошибки больше не появится.
              </p>
              <a href={documentUrl} target="_blank" rel="noreferrer">
                <ExternalLink /> Открыть предпросмотр
              </a>
            </div>
          )}
          {kind === 'unsupported' && <div className="preview-message"><FileQuestion /><h4>Предпросмотр недоступен</h4><p>Формат {formatOf(material)} можно скачать и открыть на устройстве.</p><a href={material.downloadUrl} target="_blank" rel="noreferrer"><ExternalLink /> Открыть файл</a></div>}
        </div>
        <footer className="preview-footer"><span>{material.course}</span><i /> <span>{material.subject}</span><i /> <span>{material.fileName}</span></footer>
      </section>
    </div>
  );
}
