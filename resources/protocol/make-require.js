module.exports = function makeRequire(mod) {
  const Module = mod.constructor;
  const localRequire = (request) => mod.require(request);
  localRequire.resolve = (request, options) => Module._resolveFilename(request, mod, false, options);
  localRequire.resolve.paths = (request) => Module._resolveLookupPaths(request, mod);
  localRequire.main = process.mainModule;
  localRequire.extensions = Module._extensions;
  localRequire.cache = Module._cache;
  return localRequire;
};
