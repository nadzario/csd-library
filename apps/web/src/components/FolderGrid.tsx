import { ChevronRight, Folder, FolderOpen, Home } from 'lucide-react';

export type FolderItem = { name: string; count: number };

export function FolderGrid({
  path, folders, onNavigate,
}: {
  path: string[];
  folders: FolderItem[];
  onNavigate: (path: string[]) => void;
}) {
  return (
    <>
      <nav className="breadcrumbs" aria-label="Путь к папке">
        <button onClick={() => onNavigate([])} aria-label="Корень каталога"><Home /></button>
        {path.map((segment, index) => (
          <span key={`${segment}-${index}`}><ChevronRight /><button onClick={() => onNavigate(path.slice(0, index + 1))}>{segment}</button></span>
        ))}
      </nav>
      {folders.length > 0 && <div className="folder-grid">
        {folders.map((folder) => (
          <button className="folder-card" key={folder.name} onClick={() => onNavigate([...path, folder.name])}>
            <span className="folder-icon">{path.length ? <FolderOpen /> : <Folder />}</span>
            <span><b>{folder.name}</b><small>{folder.count} файлов</small></span>
            <ChevronRight />
          </button>
        ))}
      </div>}
    </>
  );
}
