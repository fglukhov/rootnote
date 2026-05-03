import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/pages/api/auth/[...nextauth]';

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

    const sinceParam = req.query.since;
    const sinceRaw = Array.isArray(sinceParam) ? sinceParam[0] : sinceParam;
    let sinceDate: Date | null = null;

    if (typeof sinceRaw === 'string' && sinceRaw.length > 0) {
      const parsed = new Date(sinceRaw);
      if (Number.isNaN(parsed.getTime())) {
        return res.status(400).json({ error: 'Invalid "since" value' });
      }
      sinceDate = parsed;
    }

    const latestNote = await prisma.note.findFirst({
      where: { authorId: user.id },
      orderBy: { updatedAt: 'desc' },
      select: { updatedAt: true },
    });

    // Backward-compatible fallback: if NoteDeletion client/table isn't ready yet,
    // state sync for updates still works; delete sync will start after restart/migration.
    let latestDeletion: { deletedAt: Date } | null = null;
    if (
      prisma.noteDeletion &&
      typeof prisma.noteDeletion.findFirst === 'function'
    ) {
      latestDeletion = await prisma.noteDeletion.findFirst({
        where: { authorId: user.id },
        orderBy: { deletedAt: 'desc' },
        select: { deletedAt: true },
      });
    }

    const latestUpdatedAt = latestNote?.updatedAt ?? null;
    const latestDeletedAt = latestDeletion?.deletedAt ?? null;
    const latestChangeAt =
      [latestUpdatedAt, latestDeletedAt]
        .filter((v): v is Date => v instanceof Date)
        .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    const hasChanges =
      latestChangeAt != null &&
      (sinceDate == null || latestChangeAt.getTime() > sinceDate.getTime());

    return res.json({
      hasChanges,
      latestUpdatedAt: latestChangeAt ? latestChangeAt.toISOString() : null,
    });
  } catch (e) {
    console.error('API /sync/state error:', e);
    return res.status(500).json({
      error: e?.message || String(e),
      name: e?.name,
      code: e?.code,
      meta: e?.meta,
      stack: e?.stack,
    });
  }
}
