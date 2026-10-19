import { DefaultArtifactClient } from '@actions/artifact';
import { dirname } from 'node:path';
const [path, name] = process.argv.slice(2);
if (!path || !name || process.env.GITHUB_REPOSITORY !== 'nowscott/EverydayTechNews-data') throw new Error('private_archive_only');
const result = await new DefaultArtifactClient().uploadArtifact(name, [path], dirname(path), { retentionDays: 90 });
if (!result.id) throw new Error('archive_upload_failed');
