export function importsModuleAtRuntime(source, moduleName) {
  const escapedName = moduleName.replace(/[.*+?^${}()|[\]\\\/-]/g, '\\$&');
  const pattern = new RegExp(`(?:\\bfrom\\s*|\\brequire\\s*\\(\\s*|\\bimport\\s*\\(?\\s*)['"]${escapedName}(?:/[^'"]*)?['"]`);
  return pattern.test(source);
}
