import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/pages/api/auth/[...nextauth]';

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 200;
const TOMBSTONE_TTL_DAYS = 30;

export default async function handle(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({
      error: `The HTTP ${req.method} method is not supported at this route.`,
    });
  }

  try {
    const session = await getServerSession(req, res, authOptions);
    if (!session?.user?.email) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true },
    });

    if (!user?.id) {
      return res.status(401).json({ error: 'User not found' });
    }

    if (
      prisma.noteDeletion &&
      typeof prisma.noteDeletion.deleteMany === 'function'
    ) {
      const tombstoneCutoff = new Date(
        Date.now() - TOMBSTONE_TTL_DAYS * 24 * 60 * 60 * 1000,
      );
      // Keep tombstones bounded so sync metadata doesn't grow forever.
      await prisma.noteDeletion.deleteMany({
        where: {
          authorId: user.id,
          deletedAt: { lt: tombstoneCutoff },
        },
      });
    }

    const sinceParam = req.query.since;
    const sinceRaw = Array.isArray(sinceParam) ? sinceParam[0] : sinceParam;
    if (typeof sinceRaw !== 'string' || sinceRaw.length === 0) {
      return res.status(400).json({ error: '"since" is required' });
    }

    const sinceDate = new Date(sinceRaw);
    if (Number.isNaN(sinceDate.getTime())) {
      return res.status(400).json({ error: 'Invalid "since" value' });
    }

    const limitParam = req.query.limit;
    const limitRaw = Array.isArray(limitParam) ? limitParam[0] : limitParam;
    const parsedLimit =
      typeof limitRaw === 'string' ? Number.parseInt(limitRaw, 10) : NaN;
    const requestedLimit = Number.isFinite(parsedLimit)
      ? parsedLimit
      : DEFAULT_LIMIT;
    const limit = Math.min(MAX_LIMIT, Math.max(1, requestedLimit));

    const notesPromise = prisma.note.findMany({
      where: {
        authorId: user.id,
        updatedAt: { gt: sinceDate },
      },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: limit,
      select: {
        id: true,
        updatedAt: true,
        title: true,
        content: true,
        hasContent: true,
        parentId: true,
        sort: true,
        complete: true,
        collapsed: true,
        priority: true,
      },
    });

    const deletionsPromise =
      prisma.noteDeletion && typeof prisma.noteDeletion.findMany === 'function'
        ? prisma.noteDeletion.findMany({
            where: {
              authorId: user.id,
              deletedAt: { gt: sinceDate },
            },
            orderBy: [{ deletedAt: 'asc' }, { noteId: 'asc' }],
            take: limit,
            select: {
              noteId: true,
              deletedAt: true,
            },
          })
        : Promise.resolve([]);

    const [notes, deletions] = await Promise.all([
      notesPromise,
      deletionsPromise,
    ]);

    const changes = [
      ...notes.map((note) => ({
        op: 'upsert' as const,
        id: note.id,
        updatedAt: note.updatedAt.toISOString(),
        note: {
          id: note.id,
          title: note.title,
          content: note.content,
          hasContent: note.hasContent,
          parentId: note.parentId,
          sort: note.sort,
          complete: note.complete,
          collapsed: note.collapsed,
          priority: note.priority,
        },
      })),
      ...deletions.map((deletion) => ({
        op: 'delete' as const,
        id: deletion.noteId,
        updatedAt: deletion.deletedAt.toISOString(),
      })),
    ]
      .sort((a, b) => {
        const d =
          new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
        if (d !== 0) return d;
        return a.id.localeCompare(b.id);
      })
      .slice(0, limit);

    const nextSince =
      changes.length > 0
        ? changes[changes.length - 1].updatedAt
        : sinceDate.toISOString();

    return res.json({
      changes,
      nextSince,
      hasMore: changes.length === limit,
    });
  } catch (e) {
    console.error('API /sync/changes error:', e);
    return res.status(500).json({
      error: e?.message || String(e),
      name: e?.name,
      code: e?.code,
      meta: e?.meta,
      stack: e?.stack,
    });
  }
}
