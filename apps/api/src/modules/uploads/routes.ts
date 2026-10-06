import type { FastifyInstance } from 'fastify';
import { requireUser } from '../../lib/auth';
import { badRequest } from '../../lib/errors';
import { audit } from '../../lib/audit';
import { toFileRef } from '../../lib/files';
import { registerJob } from '../../jobs';
import { readMultipart } from '../documents/multipart';
import { purgeUploads, saveUpload } from './service';

registerJob('uploads-purge', '30 * * * *', async () => {
  await purgeUploads();
});

/** POST /uploads — temporary attachment for a request (API.md §8). Any staff user. */
export default async function uploadsRoutes(app: FastifyInstance) {
  app.post('/uploads', async (req, reply) => {
    const u = requireUser(req);
    const { files } = await readMultipart(req);
    const file = files[0];
    if (!file) throw badRequest('Field `file` is required');
    const stored = await saveUpload({ tenantId: u.tenantId, userId: u.userId, buffer: file.buffer, filename: file.filename });
    await audit(u, 'upload.create', 'StoredFile', stored.id, { filename: stored.filename, size: stored.size }, { ip: req.ip });
    return reply.status(201).send(toFileRef(stored));
  });
}
