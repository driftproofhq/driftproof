// SPDX-License-Identifier: Apache-2.0
'use strict';
// Spec 777 AC-11: Git Bash writes $OLDPWD as /c/...; a native Windows path is C:/...
function fromFolder(given, platform) {
  if (platform !== 'win32') return given;
  const m = /^\/([a-zA-Z])(\/.*)?$/.exec(given);
  return m ? m[1].toUpperCase() + ':' + (m[2] || '/') : given;
}
module.exports = { fromFolder };
