import { BookOpen, Download, ExternalLink, FileArchive, FileText, GraduationCap } from 'lucide-react';
import { formatBytes, type Material } from '@csd/shared';

const kindNames: Record<Material['kind'], string> = {
  lecture: 'Лекция', seminar: 'Семинар', exam: 'Экзамен', book: 'Книга',
  guide: 'Гайд', homework: 'Задание', other: 'Материал',
};

function FileIcon({ material }: { material: Material }) {
  if (material.mimeType.includes('pdf')) return <FileText size={21} />;
  if (material.mimeType.includes('zip') || material.mimeType.includes('rar')) return <FileArchive size={21} />;
  if (material.kind === 'book') return <BookOpen size={21} />;
  return <GraduationCap size={21} />;
}

export function MaterialCard({ material }: { material: Material }) {
  const canPreview = material.mimeType.includes('pdf') || material.mimeType.startsWith('image/') || material.mimeType.startsWith('text/');
  return (
    <article className="material-card">
      <div className="file-icon"><FileIcon material={material} /></div>
      <div className="material-main">
        <div className="card-meta">
          <span>{kindNames[material.kind]}</span><i />
          <span>{formatBytes(material.size)}</span>
        </div>
        <h3>{material.title}</h3>
        <p>{material.description || material.fileName}</p>
        <div className="tags">
          {material.tags.slice(0, 3).map((tag) => <span key={tag}>#{tag}</span>)}
        </div>
      </div>
      <div className="card-actions">
        {canPreview && <a className="icon-button" href={material.previewUrl || material.downloadUrl} target="_blank" rel="noreferrer" aria-label="Открыть"><ExternalLink size={18} /></a>}
        <a className="icon-button primary" href={material.downloadUrl} download aria-label="Скачать"><Download size={18} /></a>
      </div>
    </article>
  );
}
