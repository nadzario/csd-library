import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ArrowLeft, Check, CheckCircle2, Clock3, Download, Eye, FileText, FolderTree,
  KeyRound, Library, LoaderCircle, LogOut, Save, Search, ShieldCheck, Trash2, X,
} from 'lucide-react';
import {
  formatBytes, type Material, type MaterialAdminUpdate, type Submission, type SubmissionUpdate,
} from '@csd/shared';
import { apiUrl, requireApiUrl } from './lib/api';
import { extensionOf, formatOf, previewKind } from './lib/files';

const empty: Submission[] = [];
type Tab = 'queue' | 'catalog';
type PreviewFile = Pick<Material, 'title' | 'fileName' | 'mimeType' | 'size' | 'course' | 'subject'>;
type CatalogDraft = Material & { folderPath: string };

function folderOf(material: Material) {
  const suffix = `/${material.fileName}`;
  return material.path.endsWith(suffix)
    ? material.path.slice(0, -suffix.length).replace(/^\/+/, '')
    : material.path.split('/').filter(Boolean).slice(0, -1).join('/');
}

function downloadBlob(url: string, token: string, onProgress: (value: number | null) => void) {
  return new Promise<Blob>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url);
    xhr.responseType = 'blob';
    xhr.setRequestHeader('authorization', `Bearer ${token}`);
    xhr.onprogress = (event) => onProgress(event.lengthComputable ? Math.round((event.loaded / event.total) * 100) : null);
    xhr.onload = () => xhr.status >= 200 && xhr.status < 300
      ? resolve(xhr.response)
      : reject(new Error(xhr.status === 401 ? 'Сессия истекла' : 'Не удалось загрузить файл для просмотра'));
    xhr.onerror = () => reject(new Error('Соединение прервано во время загрузки файла'));
    xhr.send();
  });
}

function AdminPreview({
  file, blob, externalUrl, footer, onClose,
}: {
  file: PreviewFile; blob: Blob; externalUrl?: string; footer?: string; onClose: () => void;
}) {
  const [text, setText] = useState('');
  const objectUrl = useMemo(() => URL.createObjectURL(blob), [blob]);
  const materialLike = { ...file, downloadUrl: objectUrl, source: 'admin', path: `/${file.course}/${file.subject}/${file.fileName}` } as Material;
  const kind = previewKind(materialLike);
  const officeUrl = kind === 'office' && externalUrl
    ? `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(externalUrl)}`
    : '';

  useEffect(() => {
    if (kind === 'text') {
      blob.text().then((value) => setText(value.slice(0, 1_000_000))).catch(() => setText('Не удалось прочитать текст.'));
    }
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob, kind, objectUrl]);

  return <div className="preview-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="preview-modal moderation-preview" role="dialog" aria-modal="true">
      <header className="preview-header">
        <div><span>{formatOf(materialLike)} · {formatBytes(file.size)}</span><h3>{file.fileName}</h3></div>
        <div className="preview-actions"><a href={objectUrl} download={file.fileName}><Download /> Скачать</a><button onClick={onClose} aria-label="Закрыть"><X /></button></div>
      </header>
      <div className={`preview-stage ${kind}`}>
        {kind === 'image' && <img src={objectUrl} alt={file.title} />}
        {kind === 'pdf' && <iframe src={`${objectUrl}#view=FitH`} title={file.title} />}
        {kind === 'text' && <pre>{text || 'Читаем текст…'}</pre>}
        {kind === 'office' && officeUrl && <iframe src={officeUrl} title={file.title} />}
        {((kind === 'office' && !officeUrl) || kind === 'unsupported') && <div className="preview-message"><FileText /><h4>Формат {extensionOf(file.fileName).toUpperCase() || 'FILE'}</h4><p>Браузер не умеет безопасно показывать этот формат внутри панели. Файл уже загружен — скачайте его для проверки.</p><a href={objectUrl} download={file.fileName}><Download /> Скачать файл</a></div>}
      </div>
      <footer className="preview-footer"><span>{file.course}</span><i /><span>{file.subject}</span>{footer && <><i /><span>{footer}</span></>}</footer>
    </section>
  </div>;
}

export function Admin() {
  const [token, setToken] = useState(() => sessionStorage.getItem('csd-admin-token') || '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>('queue');
  const [submissions, setSubmissions] = useState<Submission[]>(empty);
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState<Submission | null>(null);
  const [catalogItems, setCatalogItems] = useState<Material[]>([]);
  const [catalogTotal, setCatalogTotal] = useState(0);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogDraft, setCatalogDraft] = useState<CatalogDraft | null>(null);
  const [preview, setPreview] = useState<{ file: PreviewFile; blob: Blob; externalUrl?: string; footer?: string } | null>(null);
  const [previewProgress, setPreviewProgress] = useState<number | null | undefined>(undefined);

  const logout = () => {
    sessionStorage.removeItem('csd-admin-token');
    setToken(''); setSubmissions(empty); setDraft(null); setCatalogDraft(null);
  };

  async function adminFetch(path: string, init: RequestInit = {}, authToken = token) {
    const response = await fetch(`${requireApiUrl()}${path}`, {
      ...init, headers: { ...init.headers, authorization: `Bearer ${authToken}` },
    });
    if (response.status === 401) { logout(); throw new Error('Сессия истекла'); }
    return response;
  }

  async function loadSubmissions(authToken = token) {
    if (!authToken) return;
    const response = await adminFetch('/api/submissions', {}, authToken);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Не удалось загрузить очередь');
    setSubmissions(result);
    const nextId = selectedId && result.some((item: Submission) => item.id === selectedId) ? selectedId : result[0]?.id || '';
    setSelectedId(nextId);
    setDraft(result.find((item: Submission) => item.id === nextId) || null);
  }

  async function loadCatalog(query = catalogQuery, authToken = token) {
    if (!authToken) return;
    setBusy(true);
    try {
      const response = await adminFetch(`/api/admin/materials?limit=50&query=${encodeURIComponent(query)}`, {}, authToken);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Не удалось загрузить каталог');
      setCatalogItems(result.items); setCatalogTotal(result.total);
      if (catalogDraft) {
        const fresh = result.items.find((item: Material) => item.id === catalogDraft.id);
        if (fresh) setCatalogDraft({ ...fresh, folderPath: folderOf(fresh) });
      }
    } finally { setBusy(false); }
  }

  useEffect(() => {
    if (!apiUrl) { setOnline(false); return; }
    fetch(`${apiUrl}/api/health`).then((response) => setOnline(response.ok)).catch(() => setOnline(false));
  }, []);

  useEffect(() => {
    if (token) loadSubmissions(token).catch((value) => setError(value instanceof Error ? value.message : 'Ошибка очереди'));
  }, [token]);

  async function login(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await fetch(`${requireApiUrl()}/api/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Ошибка входа');
      sessionStorage.setItem('csd-admin-token', result.token); setToken(result.token);
    } catch (value) { setError(value instanceof Error ? value.message : 'Ошибка входа'); }
    finally { setBusy(false); }
  }

  const switchTab = (next: Tab) => {
    setTab(next); setError(''); setNotice('');
    if (next === 'catalog' && !catalogItems.length) {
      loadCatalog().catch((value) => setError(value instanceof Error ? value.message : 'Ошибка каталога'));
    }
  };

  const choose = (submission: Submission) => {
    setSelectedId(submission.id); setDraft({ ...submission, tags: [...submission.tags] }); setError(''); setNotice('');
  };
  const updateDraft = (value: SubmissionUpdate) => setDraft((current) => current ? ({ ...current, ...value }) : current);

  async function save(showNotice = true) {
    if (!draft) return undefined;
    const response = await adminFetch(`/api/submissions/${draft.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: draft.title, description: draft.description, course: draft.course, subject: draft.subject,
        kind: draft.kind, tags: draft.tags, folderPath: draft.folderPath,
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Не удалось сохранить изменения');
    setDraft(result); setSubmissions((items) => items.map((item) => item.id === result.id ? result : item));
    if (showNotice) setNotice('Изменения сохранены');
    return result as Submission;
  }

  async function saveCatalogMaterial() {
    if (!catalogDraft) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const body: MaterialAdminUpdate = {
        title: catalogDraft.title, description: catalogDraft.description, course: catalogDraft.course,
        subject: catalogDraft.subject, kind: catalogDraft.kind, tags: catalogDraft.tags,
        folderPath: catalogDraft.folderPath,
      };
      const response = await adminFetch(`/api/admin/materials/${encodeURIComponent(catalogDraft.id)}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Не удалось обновить материал');
      const next = { ...result, folderPath: folderOf(result) };
      setCatalogDraft(next);
      setCatalogItems((items) => items.map((item) => item.id === result.id ? result : item));
      setNotice('Материал и его путь обновлены в каталоге');
    } catch (value) { setError(value instanceof Error ? value.message : 'Ошибка сохранения'); }
    finally { setBusy(false); }
  }

  async function act(action: 'approve' | 'reject') {
    if (!draft) return;
    if (action === 'reject' && !window.confirm(`Удалить заявку «${draft.title}» вместе с файлом?`)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      if (action === 'approve') {
        await save(false);
        const response = await adminFetch(`/api/submissions/${draft.id}/approve`, { method: 'POST' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Не удалось опубликовать материал');
        setNotice(`«${result.title}» опубликован`);
      } else {
        const response = await adminFetch(`/api/submissions/${draft.id}`, { method: 'DELETE' });
        if (!response.ok) throw new Error('Не удалось удалить заявку');
      }
      setSelectedId(''); setDraft(null); await loadSubmissions();
    } catch (value) { setError(value instanceof Error ? value.message : 'Ошибка модерации'); }
    finally { setBusy(false); }
  }

  async function openPreview(file: PreviewFile, endpoint: string, externalUrl?: string, footer?: string) {
    setPreviewProgress(null); setError('');
    try {
      const blob = await downloadBlob(`${requireApiUrl()}${endpoint}`, token, setPreviewProgress);
      setPreview({ file, blob, externalUrl, footer });
    } catch (value) {
      if (value instanceof Error && value.message === 'Сессия истекла') logout();
      setError(value instanceof Error ? value.message : 'Ошибка предпросмотра');
    } finally { setPreviewProgress(undefined); }
  }

  if (!token) return <div className="admin-shell login-page"><a href="../" className="back"><ArrowLeft size={16} /> В библиотеку</a><form className="login-card" onSubmit={login}><div className="admin-logo"><ShieldCheck /></div><span className="section-kicker">CSD Library</span><h1>Вход для<br />модераторов</h1><p>Проверка материалов, предложенных студентами.</p><label>Пароль<div className="password-field"><KeyRound size={17} /><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoFocus /></div></label>{error && <div className="form-error">{error}</div>}<button className="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" /> : 'Войти в панель'}</button><span className={`login-status ${online ? 'ok' : ''}`}>{online === null ? 'Проверяем API…' : online ? 'Сервис доступен' : 'Публичный API не подключён'}</span></form></div>;

  const previewLabel = previewProgress === undefined ? 'Предпросмотр' : previewProgress === null ? 'Загрузка…' : `Загрузка ${previewProgress}%`;

  return <div className="admin-shell moderation-shell">
    <aside>
      <div className="brand"><span>C</span><b>CSD Library</b></div>
      <div className="admin-nav"><small>Материалы</small>
        <button className={tab === 'queue' ? 'active' : ''} onClick={() => switchTab('queue')}><Clock3 />Очередь <b>{submissions.length}</b></button>
        <button className={tab === 'catalog' ? 'active' : ''} onClick={() => switchTab('catalog')}><Library />Каталог</button>
        <a href="../"><ArrowLeft />Вернуться на сайт</a>
      </div>
      <button className="logout" onClick={logout}><LogOut />Выйти</button>
    </aside>
    <section className="admin-content">
      <div className="admin-top"><div><span className="section-kicker">Админ-панель</span><h2>{tab === 'queue' ? 'Проверка материалов' : 'Редактор каталога'}</h2><p>{tab === 'queue' ? 'Откройте файл, исправьте метаданные, задайте путь и подтвердите публикацию.' : 'Найдите опубликованный материал, проверьте файл и измените карточку или вложенный путь.'}</p></div><span className={`status ${online ? 'ok' : ''}`}><i />{online ? 'API работает' : 'API недоступен'}</span></div>
      {notice && <div className="success"><CheckCircle2 /><div><b>Готово</b><span>{notice}</span></div><button onClick={() => setNotice('')}><X /></button></div>}
      {error && <div className="form-error moderation-error">{error}</div>}

      {tab === 'queue' ? <div className="moderation-layout">
        <div className="submission-list">
          <div className="queue-title"><b>Ожидают проверки</b><span>{submissions.length}</span></div>
          {submissions.length === 0 ? <div className="queue-empty"><CheckCircle2 /><b>Очередь пуста</b><span>Новые материалы появятся здесь.</span></div> : submissions.map((submission) => <button key={submission.id} className={submission.id === selectedId ? 'active' : ''} onClick={() => choose(submission)}><FileText /><span><b>{submission.title}</b><small>{submission.course} · {submission.subject}</small><small>{formatOf(submission)} · {formatBytes(submission.size)} · {new Date(submission.createdAt).toLocaleDateString('ru')}</small></span></button>)}
        </div>
        <div className="moderation-card">
          {!draft ? <div className="queue-empty large"><Clock3 /><b>Выберите заявку</b><span>Здесь появятся файл и данные для проверки.</span></div> : <>
            <div className="moderation-file"><div><FileText /><span><b>{draft.fileName}</b><small>{formatOf(draft)} · {formatBytes(draft.size)} · {draft.mimeType}</small></span></div><button onClick={() => openPreview(draft, `/api/submissions/${draft.id}/file`, undefined, draft.submitter || 'Анонимно')} disabled={previewProgress !== undefined}><Eye /> {previewLabel}</button></div>
            <div className="field-grid moderation-fields">
              <label className="wide">Название<input value={draft.title} onChange={(event) => updateDraft({ title: event.target.value })} /></label>
              <label>Раздел / курс<input value={draft.course} onChange={(event) => updateDraft({ course: event.target.value })} /></label>
              <label>Предмет<input value={draft.subject} onChange={(event) => updateDraft({ subject: event.target.value })} /></label>
              <label className="wide">Путь папки <span className="field-hint">Можно создавать любую вложенность через /</span><div className="path-field"><FolderTree /><input value={draft.folderPath} onChange={(event) => updateDraft({ folderPath: event.target.value })} placeholder={`${draft.course}/${draft.subject}/Лекции/2026`} /></div></label>
              <label>Тип<select value={draft.kind} onChange={(event) => updateDraft({ kind: event.target.value as Submission['kind'] })}><option value="lecture">Лекция</option><option value="seminar">Семинар</option><option value="exam">Экзамен</option><option value="book">Книга</option><option value="guide">Гайд</option><option value="homework">Задание</option><option value="other">Другое</option></select></label>
              <label>Теги<input value={draft.tags.join(', ')} onChange={(event) => updateDraft({ tags: event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean) })} /></label>
              <label className="wide">Описание<textarea rows={7} value={draft.description} onChange={(event) => updateDraft({ description: event.target.value })} placeholder="Добавьте понятное описание материала" /></label>
            </div>
            <div className="submitter-note"><span>Предложил</span><b>{draft.submitter || 'Анонимный пользователь'}</b></div>
            <div className="moderation-actions"><button className="danger" onClick={() => act('reject')} disabled={busy}><Trash2 /> Отклонить</button><button className="secondary" onClick={() => save().catch((value) => setError(value.message))} disabled={busy}><Save /> Сохранить</button><button className="submit" onClick={() => act('approve')} disabled={busy}>{busy ? <LoaderCircle className="spin" /> : <Check />} Опубликовать</button></div>
          </>}
        </div>
      </div> : <div className="moderation-layout catalog-editor">
        <div className="submission-list">
          <form className="catalog-search" onSubmit={(event) => { event.preventDefault(); loadCatalog().catch((value) => setError(value.message)); }}><Search /><input value={catalogQuery} onChange={(event) => setCatalogQuery(event.target.value)} placeholder="Название, предмет, путь…" /><button disabled={busy}>Найти</button></form>
          <div className="queue-title"><b>Найдено</b><span>{catalogTotal}</span></div>
          {catalogItems.length === 0 ? <div className="queue-empty"><Library /><b>Материалы не найдены</b><span>Измените поисковый запрос.</span></div> : catalogItems.map((material) => <button key={material.id} className={material.id === catalogDraft?.id ? 'active' : ''} onClick={() => { setCatalogDraft({ ...material, tags: [...material.tags], folderPath: folderOf(material) }); setError(''); setNotice(''); }}><FileText /><span><b>{material.title}</b><small>{formatOf(material)} · {formatBytes(material.size)}</small><small>{material.path}</small></span></button>)}
        </div>
        <div className="moderation-card">
          {!catalogDraft ? <div className="queue-empty large"><Library /><b>Выберите материал</b><span>Можно изменить его карточку и положение в каталоге.</span></div> : <>
            <div className="moderation-file"><div><FileText /><span><b>{catalogDraft.fileName}</b><small>{formatOf(catalogDraft)} · {formatBytes(catalogDraft.size)} · {catalogDraft.repository || 'GitHub'}</small></span></div><button onClick={() => openPreview(catalogDraft, `/api/admin/materials/${encodeURIComponent(catalogDraft.id)}/file`, catalogDraft.downloadUrl, catalogDraft.path)} disabled={previewProgress !== undefined}><Eye /> {previewLabel}</button></div>
            <div className="field-grid moderation-fields">
              <label className="wide">Название<input value={catalogDraft.title} onChange={(event) => setCatalogDraft({ ...catalogDraft, title: event.target.value })} /></label>
              <label>Раздел / курс<input value={catalogDraft.course} onChange={(event) => setCatalogDraft({ ...catalogDraft, course: event.target.value })} /></label>
              <label>Предмет<input value={catalogDraft.subject} onChange={(event) => setCatalogDraft({ ...catalogDraft, subject: event.target.value })} /></label>
              <label className="wide">Путь папки <span className="field-hint">Имя файла добавляется автоматически</span><div className="path-field"><FolderTree /><input value={catalogDraft.folderPath} onChange={(event) => setCatalogDraft({ ...catalogDraft, folderPath: event.target.value })} placeholder="1 курс/Кафедра/Предмет/Лекции/2026" /></div><small className="path-result">/{catalogDraft.folderPath.replace(/^\/+|\/+$/g, '')}/{catalogDraft.fileName}</small></label>
              <label>Тип<select value={catalogDraft.kind} onChange={(event) => setCatalogDraft({ ...catalogDraft, kind: event.target.value as Material['kind'] })}><option value="lecture">Лекция</option><option value="seminar">Семинар</option><option value="exam">Экзамен</option><option value="book">Книга</option><option value="guide">Гайд</option><option value="homework">Задание</option><option value="other">Другое</option></select></label>
              <label>Теги<input value={catalogDraft.tags.join(', ')} onChange={(event) => setCatalogDraft({ ...catalogDraft, tags: event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean) })} /></label>
              <label className="wide">Описание<textarea rows={8} value={catalogDraft.description} onChange={(event) => setCatalogDraft({ ...catalogDraft, description: event.target.value })} /></label>
            </div>
            <div className="material-identity"><span>ID: {catalogDraft.id}</span><span>Обновлён: {new Date(catalogDraft.updatedAt).toLocaleString('ru')}</span></div>
            <div className="moderation-actions"><button className="submit" onClick={saveCatalogMaterial} disabled={busy}>{busy ? <LoaderCircle className="spin" /> : <Save />} Сохранить материал</button></div>
          </>}
        </div>
      </div>}
    </section>
    {preview && <AdminPreview {...preview} onClose={() => setPreview(null)} />}
  </div>;
}
