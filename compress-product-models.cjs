#!/usr/bin/env node
// Compress product models already uploaded to Firebase Storage.
// Uses Application Default Credentials; no service-account key is stored in this project.
const admin = require('firebase-admin');
const { gzipSync } = require('node:zlib');

const DATABASE_URL = 'https://webshop-3cf70-default-rtdb.europe-west1.firebasedatabase.app';
const STORAGE_BUCKET = 'webshop-3cf70.firebasestorage.app';
const MAX_MODEL_BYTES = 10 * 1024 * 1024;

async function main() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error('Stel GOOGLE_APPLICATION_CREDENTIALS in naar een Firebase-service-accountbestand voordat je dit script uitvoert.');
    process.exitCode = 1;
    return;
  }

  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    databaseURL: DATABASE_URL,
    storageBucket: STORAGE_BUCKET
  });

  const db = admin.database();
  const bucket = admin.storage().bucket();
  const snapshot = await db.ref('products').once('value');
  const products = snapshot.val() || {};
  let compressedCount = 0;
  let unchangedCount = 0;
  let skippedCount = 0;

  for (const [productId, product] of Object.entries(products)) {
    const model = product && product.model3d;
    if (!model || !model.storagePath || model.encoding !== 'raw') {
      if (model && model.data && !model.storagePath) {
        console.log(`[${productId}] Oud model in Realtime Database overgeslagen (blijft compatibel).`);
        skippedCount++;
      }
      continue;
    }

    if (!String(model.storagePath).startsWith(`product-models/${productId}/`)) {
      console.warn(`[${productId}] Onverwacht opslagpad; overgeslagen.`);
      skippedCount++;
      continue;
    }

    const sourcePath = model.storagePath;
    const sourceFile = bucket.file(sourcePath);
    try {
      const [raw] = await sourceFile.download();
      if (!raw.length || raw.length > MAX_MODEL_BYTES) {
        console.warn(`[${productId}] Bestandsgrootte buiten de 10 MiB-grens; overgeslagen.`);
        skippedCount++;
        continue;
      }

      const compressed = gzipSync(raw, { level: 9 });
      if (compressed.length >= raw.length) {
        console.log(`[${productId}] Gzip levert geen kleinere file op; origineel behouden.`);
        unchangedCount++;
        continue;
      }

      const compressedPath = `${sourcePath}.gz`;
      const compressedFile = bucket.file(compressedPath);
      await compressedFile.save(compressed, {
        resumable: false,
        validation: 'crc32c',
        metadata: {
          contentType: 'application/octet-stream',
          cacheControl: 'public, max-age=31536000, immutable',
          metadata: {
            format: String(model.format || ''),
            originalName: String(model.name || ''),
            compression: 'gzip'
          }
        }
      });

      const modelRef = db.ref(`products/${productId}/model3d`);
      const result = await modelRef.transaction(current => {
        if (!current || current.storagePath !== sourcePath || current.encoding !== 'raw') return;
        return {
          ...current,
          storagePath: compressedPath,
          encoding: 'gzip',
          storedBytes: compressed.length,
          compressedAt: Date.now()
        };
      });

      if (!result.committed) {
        await compressedFile.delete({ ignoreNotFound: true }).catch(() => {});
        console.log(`[${productId}] Model is intussen gewijzigd; compressiebestand opgeruimd.`);
        skippedCount++;
        continue;
      }

      // Remove the larger original only after the database points to the compressed object.
      await sourceFile.delete({ ignoreNotFound: true });
      console.log(`[${productId}] ${raw.length} -> ${compressed.length} bytes (${Math.round((1 - compressed.length / raw.length) * 100)}% kleiner).`);
      compressedCount++;
    } catch (error) {
      console.error(`[${productId}] Compressie mislukt:`, error.message || error);
      skippedCount++;
    }
  }

  console.log(`Klaar. Gecomprimeerd: ${compressedCount}; niet kleiner: ${unchangedCount}; overgeslagen/fout: ${skippedCount}.`);
  await admin.app().delete();
}

main().catch(async error => {
  console.error('Script afgebroken:', error);
  try { await admin.app().delete(); } catch {}
  process.exitCode = 1;
});
