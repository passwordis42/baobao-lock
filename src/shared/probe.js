'use strict';

/** Magic dwExtraInfo for the install-time swallow probe. Not a user key. */
const PROBE_EXTRA = 0x4242424b;

function isProbeExtra(extra) {
  if (extra == null || extra === false) return false;
  try {
    return BigInt(extra) === BigInt(PROBE_EXTRA);
  } catch (err) {
    return extra === PROBE_EXTRA;
  }
}

module.exports = { PROBE_EXTRA, isProbeExtra };
