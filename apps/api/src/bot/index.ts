import { Bot, InlineKeyboard } from 'grammy';
import { Readable } from 'node:stream';
import { formatBytes, materialKindSchema, type Material } from '@csd/shared';
import { config } from '../config.js';
import { GitHubPublisher } from '../services/github-publisher.js';
import { saveStream } from '../services/temp-file.js';
import { callbackKey, CatalogBrowser, type NamedCount } from './catalog-browser.js';

const help = `Библиотека CSD

Ищите и скачивайте материалы прямо в боте:
• /materials — каталог по курсам и предметам
• /search запрос — поиск по всей библиотеке
• /site — открыть расширенную веб-версию

Администраторы могут прислать документ с подписью:

Курс | Предмет | Тип | Название | теги через запятую

Тип: lecture, seminar, exam, book, guide, homework или other.`;

const PAGE_SIZE = 8;
const short = (value: string, length = 48) => value.length > length ? `${value.slice(0, length - 1)}…` : value;

function pageButtons(items: NamedCount[], page: number, prefix: string, paginationPrefix = `${prefix}s`) {
  const lastPage = Math.max(0, Math.ceil(items.length / PAGE_SIZE) - 1);
  const safePage = Math.max(0, Math.min(page, lastPage));
  const keyboard = new InlineKeyboard();
  for (const item of items.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE)) keyboard.text(`${short(item.name, 38)} · ${item.count}`, `${prefix}:${item.key}:0`).row();
  if (lastPage > 0) {
    if (safePage > 0) keyboard.text('←', `${paginationPrefix}:${safePage - 1}`);
    keyboard.text(`${safePage + 1}/${lastPage + 1}`, 'noop');
    if (safePage < lastPage) keyboard.text('→', `${paginationPrefix}:${safePage + 1}`);
    keyboard.row();
  }
  return { keyboard, safePage };
}

function materialText(material: Material) {
  const kinds: Record<Material['kind'], string> = { lecture: 'Лекция', seminar: 'Семинар', exam: 'Экзамен', book: 'Книга', guide: 'Гайд', homework: 'Задание', other: 'Материал' };
  return `📄 ${material.title}\n\n${material.description ? `${material.description}\n\n` : ''}🎓 ${material.course}\n📚 ${material.subject}\n🏷 ${kinds[material.kind]}${material.tags.length ? ` · ${material.tags.map((tag) => `#${tag}`).join(' ')}` : ''}\n💾 ${formatBytes(material.size)} · ${material.fileName}`;
}

export function createBot(publisher: GitHubPublisher) {
  if (!config.TELEGRAM_BOT_TOKEN) return null;
  const bot = new Bot(config.TELEGRAM_BOT_TOKEN);
  const browser = new CatalogBrowser(publisher.catalog);
  bot.command(['start', 'help'], (ctx) => ctx.reply(help, {
    reply_markup: new InlineKeyboard().text('📚 Смотреть материалы', 'courses:0').row().url('🌐 Открыть сайт', config.PUBLIC_SITE_URL),
  }));
  bot.command('site', (ctx) => ctx.reply('Расширенная версия каталога:', { reply_markup: new InlineKeyboard().url('Открыть сайт', config.PUBLIC_SITE_URL) }));
  bot.command('materials', async (ctx) => {
    const courses = await browser.courses();
    if (!courses.length) return ctx.reply('Каталог пока пуст. Загляните чуть позже.');
    const { keyboard } = pageButtons(courses, 0, 'course');
    return ctx.reply(`📚 Выберите раздел\n\nВ библиотеке ${courses.reduce((sum, item) => sum + item.count, 0)} материалов.`, { reply_markup: keyboard });
  });
  bot.command('search', async (ctx) => {
    const query = String(ctx.match || '').trim();
    if (!query) return ctx.reply('Напишите запрос после команды. Например:\n/search математический анализ');
    const found = await browser.search(query);
    if (!found.length) return ctx.reply(`По запросу «${short(query, 80)}» ничего не найдено.`);
    const keyboard = new InlineKeyboard();
    for (const material of found) keyboard.text(short(material.title), `material:${callbackKey(material.id)}`).row();
    return ctx.reply(`🔎 Результаты по запросу «${short(query, 60)}»\n\nПоказано: ${found.length}`, { reply_markup: keyboard });
  });

  bot.callbackQuery('noop', (ctx) => ctx.answerCallbackQuery());
  bot.callbackQuery(/^courses:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const courses = await browser.courses();
    const { keyboard } = pageButtons(courses, Number(ctx.match[1]), 'course');
    return ctx.editMessageText(`📚 Выберите раздел\n\nВ библиотеке ${courses.reduce((sum, item) => sum + item.count, 0)} материалов.`, { reply_markup: keyboard });
  });
  bot.callbackQuery(/^course:([a-f0-9]{10}):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const course = await browser.course(ctx.match[1]!);
    if (!course) return ctx.editMessageText('Раздел не найден — каталог мог обновиться. Нажмите /materials.');
    const subjects = await browser.subjects(course.name);
    const { keyboard } = pageButtons(subjects, Number(ctx.match[2]), `subject:${course.key}`, `subjects:${course.key}`);
    keyboard.text('← Все разделы', 'courses:0');
    return ctx.editMessageText(`🎓 ${course.name}\n\nВыберите предмет:`, { reply_markup: keyboard });
  });
  bot.callbackQuery(/^subjects:([a-f0-9]{10}):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const course = await browser.course(ctx.match[1]!);
    if (!course) return ctx.editMessageText('Раздел не найден. Нажмите /materials.');
    const subjects = await browser.subjects(course.name);
    const { keyboard } = pageButtons(subjects, Number(ctx.match[2]), `subject:${course.key}`, `subjects:${course.key}`);
    keyboard.text('← Все разделы', 'courses:0');
    return ctx.editMessageText(`🎓 ${course.name}\n\nВыберите предмет:`, { reply_markup: keyboard });
  });
  bot.callbackQuery(/^subject:([a-f0-9]{10}):([a-f0-9]{10}):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const course = await browser.course(ctx.match[1]!);
    if (!course) return ctx.editMessageText('Раздел не найден. Нажмите /materials.');
    const subject = await browser.subject(course.name, ctx.match[2]!);
    if (!subject) return ctx.editMessageText('Предмет не найден. Нажмите /materials.');
    const materials = await browser.bySubject(course.name, subject.name);
    const page = Math.max(0, Math.min(Number(ctx.match[3]), Math.max(0, Math.ceil(materials.length / PAGE_SIZE) - 1)));
    const keyboard = new InlineKeyboard();
    for (const material of materials.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)) keyboard.text(short(material.title), `material:${callbackKey(material.id)}`).row();
    const pages = Math.ceil(materials.length / PAGE_SIZE);
    if (pages > 1) {
      if (page > 0) keyboard.text('←', `subject:${ctx.match[1]}:${ctx.match[2]}:${page - 1}`);
      keyboard.text(`${page + 1}/${pages}`, 'noop');
      if (page + 1 < pages) keyboard.text('→', `subject:${ctx.match[1]}:${ctx.match[2]}:${page + 1}`);
      keyboard.row();
    }
    keyboard.text('← К предметам', `course:${ctx.match[1]}:0`);
    return ctx.editMessageText(`📚 ${subject.name}\n🎓 ${course.name}\n\nМатериалов: ${materials.length}`, { reply_markup: keyboard });
  });
  bot.callbackQuery(/^material:([a-f0-9]{10})$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const material = await browser.find(ctx.match[1]!);
    if (!material) return ctx.editMessageText('Материал не найден — каталог мог обновиться. Нажмите /materials.');
    const course = callbackKey(material.course); const subject = callbackKey(`${material.course}\0${material.subject}`);
    const keyboard = new InlineKeyboard().url('⬇️ Просмотреть / скачать', material.downloadUrl).row().text('← К списку', `subject:${course}:${subject}:0`);
    return ctx.editMessageText(materialText(material), { reply_markup: keyboard });
  });
  bot.command('admin', async (ctx) => {
    if (!ctx.from || !config.adminTelegramIds.has(ctx.from.id)) return ctx.reply('Нет доступа.');
    return ctx.reply('Откройте панель администратора:', {
      reply_markup: new InlineKeyboard().url('Админ-панель', `${config.PUBLIC_SITE_URL.replace(/\/$/, '')}/admin`),
    });
  });
  bot.on('message:document', async (ctx) => {
    if (!config.adminTelegramIds.has(ctx.from.id)) return ctx.reply('Отправлять материалы могут только администраторы.');
    const values = (ctx.message.caption || '').split('|').map((x) => x.trim());
    const [course, subject, kindRaw, title, tagsRaw = ''] = values;
    const kind = materialKindSchema.safeParse(kindRaw || 'other');
    if (!course || !subject || !title || !kind.success) return ctx.reply('Неверная подпись. Используйте:\nКурс | Предмет | Тип | Название | теги');
    const status = await ctx.reply('⏳ Загружаю материал в GitHub…');
    let saved: Awaited<ReturnType<typeof saveStream>> | undefined;
    try {
      const file = await ctx.api.getFile(ctx.message.document.file_id);
      if (!file.file_path) throw new Error('Telegram did not return a file path');
      const response = await fetch(`https://api.telegram.org/file/bot${config.TELEGRAM_BOT_TOKEN}/${file.file_path}`);
      if (!response.ok || !response.body) throw new Error(`Telegram download failed: ${response.status}`);
      saved = await saveStream(Readable.fromWeb(response.body as any));
      const material = await publisher.publish({
        filePath: saved.path, originalName: ctx.message.document.file_name || 'material',
        mimeType: ctx.message.document.mime_type || 'application/octet-stream', sha256: saved.sha256,
        course, subject, kind: kind.data, title, description: '',
        tags: tagsRaw.split(',').map((x) => x.trim()).filter(Boolean), source: 'telegram',
        author: `${ctx.from.first_name}${ctx.from.username ? ` (@${ctx.from.username})` : ''}`,
      });
      browser.invalidate();
      await ctx.api.editMessageText(ctx.chat.id, status.message_id, `✅ «${material.title}» опубликован.\n${config.PUBLIC_SITE_URL}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
      await ctx.api.editMessageText(ctx.chat.id, status.message_id, `❌ Не удалось опубликовать: ${message.slice(0, 300)}`);
    } finally { await saved?.cleanup(); }
  });
  bot.catch(async ({ error, ctx }) => {
    console.error('Telegram bot error:', error);
    await ctx.reply('Не удалось открыть каталог. Попробуйте ещё раз через минуту.').catch(() => undefined);
  });
  return bot;
}
