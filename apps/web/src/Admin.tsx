import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, CheckCircle2, CloudUpload, File, KeyRound, LoaderCircle, LogOut, ShieldCheck, X } from 'lucide-react';

const api = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export function Admin() {
  const [token, setToken] = useState(() => sessionStorage.getItem('csd-admin-token') || '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [published, setPublished] = useState('');
  const [online, setOnline] = useState<boolean | null>(null);
  useEffect(() => { fetch(`${api}/api/health`).then((r) => setOnline(r.ok)).catch(() => setOnline(false)); }, []);

  async function login(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await fetch(`${api}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Ошибка входа');
      sessionStorage.setItem('csd-admin-token', result.token); setToken(result.token);
    } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка входа'); }
    finally { setBusy(false); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!file) return setError('Выберите файл');
    setBusy(true); setError(''); setPublished('');
    const data = new FormData(event.currentTarget); data.set('file', file);
    try {
      const response = await fetch(`${api}/api/materials`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: data });
      const result = await response.json();
      if (response.status === 401) { sessionStorage.removeItem('csd-admin-token'); setToken(''); throw new Error('Сессия истекла'); }
      if (!response.ok) throw new Error(result.error || 'Не удалось опубликовать');
      setPublished(result.title); setFile(null); event.currentTarget.reset();
    } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка публикации'); }
    finally { setBusy(false); }
  }

  if (!token) return <div className="admin-shell login-page"><a href="/" className="back"><ArrowLeft size={16} /> В библиотеку</a><form className="login-card" onSubmit={login}><div className="admin-logo"><ShieldCheck /></div><span className="section-kicker">CSD Library</span><h1>Вход для<br />редакторов</h1><p>Публикация материалов доступна администраторам проекта.</p><label>Пароль<div className="password-field"><KeyRound size={17} /><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus /></div></label>{error && <div className="form-error">{error}</div>}<button className="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" /> : 'Войти в панель'}</button></form></div>;

  return <div className="admin-shell">
    <aside><div className="brand"><span>C</span><b>CSD Library</b></div><div className="admin-nav"><small>Управление</small><a className="active"><CloudUpload />Новый материал</a><a href="/"><ArrowLeft />Вернуться на сайт</a></div><button className="logout" onClick={() => { sessionStorage.removeItem('csd-admin-token'); setToken(''); }}><LogOut />Выйти</button></aside>
    <section className="admin-content"><div className="admin-top"><div><span className="section-kicker">Админ-панель</span><h2>Добавить материал</h2><p>Файл будет загружен в нужный GitHub-репозиторий, а каталог обновится автоматически.</p></div><span className={`status ${online ? 'ok' : ''}`}><i />{online === null ? 'Проверка…' : online ? 'Система работает' : 'API недоступен'}</span></div>
      {published && <div className="success"><CheckCircle2 /><div><b>Материал опубликован</b><span>«{published}» уже добавлен в каталог.</span></div><button onClick={() => setPublished('')}><X /></button></div>}
      <form className="publish-form" onSubmit={submit}>
        <div className="form-section"><div className="form-number">01</div><div className="form-body"><h3>Файл</h3><p>PDF, документы, изображения или архивы до 2 ГБ.</p><label className={`dropzone ${file ? 'selected' : ''}`} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); setFile(e.dataTransfer.files[0] || null); }}><input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />{file ? <><File /><b>{file.name}</b><span>{(file.size / 1048576).toFixed(1)} МБ · Нажмите, чтобы заменить</span></> : <><CloudUpload /><b>Перетащите файл сюда</b><span>или нажмите, чтобы выбрать</span></>}</label></div></div>
        <div className="form-section"><div className="form-number">02</div><div className="form-body"><h3>Описание</h3><p>Эти данные помогут студентам найти материал.</p><div className="field-grid"><label className="wide">Название<input name="title" required placeholder="Например, конспект лекций за осенний семестр" /></label><label>Раздел / курс<input name="course" required placeholder="2 курс" /></label><label>Предмет<input name="subject" required placeholder="Линейная алгебра" /></label><label>Тип<select name="kind" defaultValue="other"><option value="lecture">Лекция</option><option value="seminar">Семинар</option><option value="exam">Экзамен</option><option value="book">Книга</option><option value="guide">Гайд</option><option value="homework">Задание</option><option value="other">Другое</option></select></label><label>Теги<input name="tags" placeholder="экзамен, 2025, билеты" /></label><label className="wide">Краткое описание<textarea name="description" rows={4} placeholder="Что внутри файла и кому он будет полезен" /></label></div></div></div>
        {error && <div className="form-error">{error}</div>}<div className="publish-actions"><span>После публикации файл нельзя изменить без создания новой версии.</span><button className="submit" disabled={busy || !file}>{busy ? <><LoaderCircle className="spin" /> Публикуем…</> : <><CloudUpload /> Опубликовать</>}</button></div>
      </form>
    </section>
  </div>;
}
