import { useEffect, useMemo, useState } from 'react';
import { Bot, ChevronDown, CircleAlert, FileStack, Github, Search, SlidersHorizontal, Sparkles, X } from 'lucide-react';
import type { Catalog, Material } from '@csd/shared';
import { loadCatalog } from './lib/catalog';
import { MaterialCard } from './components/MaterialCard';
import { FolderGrid, type FolderItem } from './components/FolderGrid';
import { PreviewModal } from './components/PreviewModal';
import { pathParts } from './lib/files';

const all = 'Все';

export function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [course, setCourse] = useState(all);
  const [subject, setSubject] = useState(all);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [folderPath, setFolderPath] = useState<string[]>([]);
  const [preview, setPreview] = useState<Material | null>(null);

  useEffect(() => { loadCatalog().then(setCatalog).catch((e: Error) => setError(e.message)); }, []);
  const materials = catalog?.materials || [];
  const courses = useMemo(() => [all, ...new Set(materials.map((m) => m.course))], [materials]);
  const subjects = useMemo(() => [all, ...new Set(materials.filter((m) => course === all || m.course === course).map((m) => m.subject))], [materials, course]);
  const filtered = useMemo(() => {
    const words = query.toLocaleLowerCase('ru').trim().split(/\s+/).filter(Boolean);
    return materials.filter((m: Material) => {
      const haystack = [m.title, m.description, m.subject, m.course, m.fileName, ...m.tags].join(' ').toLocaleLowerCase('ru');
      return (course === all || m.course === course) && (subject === all || m.subject === subject) && words.every((word) => haystack.includes(word));
    });
  }, [materials, query, course, subject]);

  const browser = useMemo(() => {
    if (query.trim()) return {
      folders: [] as FolderItem[],
      files: [...filtered].sort((a, b) => a.title.localeCompare(b.title, 'ru', { numeric: true })),
      total: filtered.length,
    };
    const folders = new Map<string, number>();
    const files: Material[] = [];
    let total = 0;
    for (const material of filtered) {
      const parts = pathParts(material.path);
      if (!folderPath.every((segment, index) => parts[index] === segment)) continue;
      total += 1;
      if (parts.length === folderPath.length + 1) files.push(material);
      else if (parts.length > folderPath.length + 1) {
        const child = parts[folderPath.length]!;
        folders.set(child, (folders.get(child) || 0) + 1);
      }
    }
    return {
      folders: [...folders].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true })),
      files: files.sort((a, b) => a.title.localeCompare(b.title, 'ru', { numeric: true })),
      total,
    };
  }, [filtered, folderPath, query]);

  const clear = () => { setQuery(''); setCourse(all); setSubject(all); setFolderPath([]); };
  const changeCourse = (value: string) => {
    setCourse(value); setSubject(all); setFolderPath(value === all ? [] : [value]);
  };
  const changeSubject = (value: string) => {
    setSubject(value);
    if (course !== all) setFolderPath(value === all ? [course] : [course, value]);
  };
  const navigateFolder = (path: string[]) => {
    setFolderPath(path);
    setCourse(path[0] || all);
    setSubject(path[1] || all);
    setQuery('');
  };

  return (
    <div className="app-shell">
      <header>
        <a className="brand" href="#top" aria-label="CSD Library"><span>C</span><b>CSD Library</b></a>
        <nav><a href="#catalog">Материалы</a><a href="#about">О проекте</a></nav>
        <a className="bot-link" href={import.meta.env.VITE_TELEGRAM_BOT_URL || '#about'}><Bot size={17} /> Telegram-бот</a>
      </header>

      <main id="top">
        <section className="hero">
          <div className="eyebrow"><Sparkles size={14} /> Сделано студентами для студентов</div>
          <h1>Всё нужное для учёбы.<br /><em>В одном месте.</em></h1>
          <p>Конспекты, лекции, задания и гайды по курсам факультета — открыто, удобно и бесплатно.</p>
          <div className="search-box"><Search size={22} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Найти предмет, лекцию или файл…" /><kbd>⌘ K</kbd></div>
          <div className="hero-stats">
            <div><strong>{materials.length}</strong><span>материалов</span></div>
            <div><strong>{Math.max(courses.length - 1, 0)}</strong><span>разделов</span></div>
            <div><strong>24/7</strong><span>свободный доступ</span></div>
          </div>
        </section>

        <section className="catalog" id="catalog">
          <div className="section-heading">
            <div><span className="section-kicker">Библиотека</span><h2>Учебные материалы</h2></div>
            <button className="filter-toggle" onClick={() => setFiltersOpen(!filtersOpen)}><SlidersHorizontal size={17} /> Фильтры <ChevronDown size={16} /></button>
          </div>
          <div className={`filters ${filtersOpen ? 'open' : ''}`}>
            <label>Курс<select value={course} onChange={(e) => changeCourse(e.target.value)}>{courses.map((x) => <option key={x}>{x}</option>)}</select></label>
            <label>Предмет<select value={subject} onChange={(e) => changeSubject(e.target.value)}>{subjects.map((x) => <option key={x}>{x}</option>)}</select></label>
            {(query || course !== all || subject !== all || folderPath.length > 0) && <button className="clear" onClick={clear}><X size={15} /> Сбросить</button>}
            <span className="result-count">{query ? 'Найдено' : 'В папке'}: {browser.total}</span>
          </div>

          {error ? <div className="state error"><CircleAlert /><h3>Не удалось загрузить каталог</h3><p>{error}</p></div> : !catalog ? <div className="state"><div className="loader" /><p>Собираем библиотеку…</p></div> : <>
            {!query && <FolderGrid path={folderPath} folders={browser.folders} onNavigate={navigateFolder} />}
            {browser.files.length > 0 && <div className="materials-caption"><b>{query ? 'Результаты поиска' : folderPath.at(-1) || 'Файлы'}</b><span>{browser.files.length} файлов</span></div>}
            {browser.files.length > 0 && <div className="materials-grid">{browser.files.map((m) => <MaterialCard material={m} key={m.id} onPreview={setPreview} />)}</div>}
            {browser.files.length === 0 && browser.folders.length === 0 && <div className="state"><Search /><h3>Ничего не найдено</h3><p>Попробуйте изменить запрос или вернуться в корень каталога.</p><button onClick={clear}>Показать всё</button></div>}
          </>}
        </section>

        <section className="about" id="about">
          <div><span className="section-kicker">Открытые знания</span><h2>Библиотека живёт,<br />пока мы ею делимся.</h2></div>
          <p>Материалы хранятся в открытых GitHub-репозиториях. Нашли полезный конспект или заметили ошибку? Отправьте файл через бота — после проверки он появится здесь.</p>
          <div className="about-links"><a href={import.meta.env.VITE_TELEGRAM_BOT_URL || '#'}><Bot />Предложить материал</a><a href="https://github.com" target="_blank" rel="noreferrer"><Github />Исходный код</a></div>
        </section>
      </main>
      <footer><div className="brand small"><span>C</span><b>CSD Library</b></div><p>Некоммерческий студенческий проект</p><span><FileStack size={14} /> Каталог обновляется автоматически</span></footer>
      {preview && <PreviewModal material={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
