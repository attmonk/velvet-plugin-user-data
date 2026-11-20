import crypto from 'crypto';

const ENVELOPE_VERSION = 1;
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const ENCRYPTION_KEY_ID = 'primary';
const KEY_INFO_PREFIX = 'attmonk-user-data';
const KEY_SALT = 'attmonk-user-data-salt';

function getConfiguredMasterKey() {
  const configuredKey = process.env.USER_DATA_ENCRYPTION_KEY;
  if (configuredKey) {
    if (configuredKey === 'unset') {
      throw new Error('USER_DATA_ENCRYPTION_KEY is set to placeholder value "unset"');
    }

    let decodedKey;
    try {
      decodedKey = Buffer.from(configuredKey, 'base64');
    } catch {
      throw new Error('USER_DATA_ENCRYPTION_KEY must be valid base64');
    }

    if (decodedKey.length < 32) {
      throw new Error('USER_DATA_ENCRYPTION_KEY must decode to at least 32 bytes');
    }

    return decodedKey;
  }

  if (process.env.VITE_DISABLE_AUTH === 'true') {
    return crypto
      .createHash('sha256')
      .update(process.env.USER_DATA_DEV_ENCRYPTION_SEED || 'attmonk-user-data-dev-encryption')
      .digest();
  }

  throw new Error('USER_DATA_ENCRYPTION_KEY is required for encrypted user data storage');
}

function deriveEncryptionKey(userId, dataType) {
  const masterKey = getConfiguredMasterKey();
  return crypto.hkdfSync(
    'sha256',
    masterKey,
    Buffer.from(process.env.USER_DATA_ENCRYPTION_SALT || KEY_SALT, 'utf8'),
    Buffer.from(`${process.env.USER_DATA_ENCRYPTION_INFO_PREFIX || KEY_INFO_PREFIX}:${userId}:${dataType}`, 'utf8'),
    32
  );
}

function buildAad(userId, dataType) {
  return Buffer.from(JSON.stringify({ userId, dataType, v: ENVELOPE_VERSION }), 'utf8');
}

export function isEncryptedUserDataEnvelope(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  return (
    value.v === ENVELOPE_VERSION &&
    value.alg === ENCRYPTION_ALGORITHM &&
    typeof value.kid === 'string' &&
    typeof value.iv === 'string' &&
    typeof value.tag === 'string' &&
    typeof value.ciphertext === 'string'
  );
}

export function encryptUserData(userId, dataType, payload) {
  const key = deriveEncryptionKey(userId, dataType);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  cipher.setAAD(buildAad(userId, dataType));

  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    v: ENVELOPE_VERSION,
    alg: ENCRYPTION_ALGORITHM,
    kid: ENCRYPTION_KEY_ID,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

export function decryptUserData(userId, dataType, envelope) {
  if (!isEncryptedUserDataEnvelope(envelope)) {
    throw new Error('Invalid encrypted user data envelope');
  }

  const key = deriveEncryptionKey(userId, dataType);
  const decipher = crypto.createDecipheriv(
    ENCRYPTION_ALGORITHM,
    key,
    Buffer.from(envelope.iv, 'base64')
  );
  decipher.setAAD(buildAad(userId, dataType));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final(),
  ]);

  return JSON.parse(plaintext.toString('utf8'));
}

/**
 * Helpers for encrypting arbitrary values stored in SQLite (kv_store, etc.).
 * Uses the same master key material but with fixed "system" identifiers so that
 * global or kv data is protected at rest without being tied to a specific user.
 * All values in SQLite should go through encryption per the "encrypt everything in sqlite" rule.
 */
export function encryptKvValue(key, payload) {
  // Use a synthetic user id for kv entries. The key provides further diversification.
  return encryptUserData('__kv_store__', key, payload);
}

export function decryptKvValue(key, envelope) {
  return decryptUserData('__kv_store__', key, envelope);
}

export function encryptSystemData(dataType, payload) {
  return encryptUserData('__system__', dataType, payload);
}

export function decryptSystemData(dataType, envelope) {
  return decryptUserData('__system__', dataType, envelope);
}
