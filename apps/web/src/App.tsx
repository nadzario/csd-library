import { useEffect, useMemo, useState } from 'react';
import { Bot, ChevronDown, CircleAlert, FileStack, Github, Search, SlidersHorizontal, Sparkles, X } from 'lucide-react';
import type { Catalog, Material } from '@csd/shared';
import { loadCatalog } from './lib/catalog';
import { MaterialCard } from './components/MaterialCard';

const all = 'Все';

export function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [course, setCourse] = useState(all);
  const [subject, setSubject] = useState(all);
  const [filtersOpen, setFiltersOpen] = useState(false);

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

  const clear = () => { setQuery(''); setCourse(all); setSubject(all); };
  const newest = [...filtered].sort((a, b) => b.addedAt.localeCompare(a.addedAt));

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
            <label>Курс<select value={course} onChange={(e) => { setCourse(e.target.value); setSubject(all); }}>{courses.map((x) => <option key={x}>{x}</option>)}</select></label>
            <label>Предмет<select value={subject} onChange={(e) => setSubject(e.target.value)}>{subjects.map((x) => <option key={x}>{x}</option>)}</select></label>
            {(query || course !== all || subject !== all) && <button className="clear" onClick={clear}><X size={15} /> Сбросить</button>}
            <span className="result-count">Найдено: {filtered.length}</span>
          </div>

          {error ? <div className="state error"><CircleAlert /><h3>Не удалось загрузить каталог</h3><p>{error}</p></div> : !catalog ? <div className="state"><div className="loader" /><p>Собираем библиотеку…</p></div> : newest.length === 0 ? <div className="state"><Search /><h3>Ничего не найдено</h3><p>Попробуйте изменить запрос или фильтры.</p><button onClick={clear}>Показать всё</button></div> : <div className="materials-grid">{newest.map((m) => <MaterialCard material={m} key={m.id} />)}</div>}
        </section>

        <section className="about" id="about">
          <div><span className="section-kicker">Открытые знания</span><h2>Библиотека живёт,<br />пока мы ею делимся.</h2></div>
          <p>Материалы хранятся в открытых GitHub-репозиториях. Нашли полезный конспект или заметили ошибку? Отправьте файл через бота — после проверки он появится здесь.</p>
          <div className="about-links"><a href={import.meta.env.VITE_TELEGRAM_BOT_URL || '#'}><Bot />Предложить материал</a><a href="https://github.com" target="_blank" rel="noreferrer"><Github />Исходный код</a></div>
        </section>
      </main>
      <footer><div className="brand small"><span>C</span><b>CSD Library</b></div><p>Некоммерческий студенческий проект</p><span><FileStack size={14} /> Каталог обновляется автоматически</span></footer>
    </div>
  );
}
