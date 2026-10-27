import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { sourceFunction } from '../helpers/source-handler';

function scope(path: string, values: Map<string,string>) {
  const module = { exports: {} as any };
  runInNewContext(ts.transpileModule(readFileSync('app/lib/browser-session.ts','utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module, exports: module.exports, window: { location: { pathname: path } }, localStorage: {
    getItem: (key:string) => values.get(key) ?? null,
    setItem: (key:string,value:string) => values.set(key,value),
    removeItem: (key:string) => values.delete(key),
  }});
  return module.exports;
}

describe('independent guide and operator sessions', () => {
  it('isolates identity, cookies, locks and offline authority while keeping operator keys compatible', () => {
    const values = new Map<string,string>(), admin=scope('/settings',values), guide=scope('/simpleguide',values);
    admin.authStorage.setItem('ck_admin_email','owner@example.invalid');
    guide.authStorage.setItem('ck_admin_email','guide@example.invalid');
    expect(admin.authStorage.getItem('ck_admin_email')).toBe('owner@example.invalid');
    expect(guide.authStorage.getItem('ck_admin_email')).toBe('guide@example.invalid');
    expect(admin.sessionKey('lock')).toBe('lock');
    expect(guide.sessionKey('lock')).not.toBe(admin.sessionKey('lock'));
    expect(guide.sessionCookie('ck_admin_role')).not.toBe(admin.sessionCookie('ck_admin_role'));
    expect(guide.guideQueueAuthorityKey).not.toBe(admin.guideQueueAuthorityKey);
    expect(guide.guideWorkerScope).not.toBe(admin.guideWorkerScope);
    guide.authStorage.removeItem('ck_admin_email');
    expect(admin.authStorage.getItem('ck_admin_email')).toBe('owner@example.invalid');
  });
  it.each(['/simpleguide','/simpleguide/check-ins','/simpleguide/photos/11111111-1111-4111-8111-111111111111','/guide-setup'])('retains guide identity on %s', path => {
    expect(scope(path,new Map()).guideSession).toBe(true);
  });
  it.each(['/','/simple','/guide','/guide/photos/11111111-1111-4111-8111-111111111111','/change-password'])('keeps operator identity on %s', path => {
    expect(scope(path,new Map()).guideSession).toBe(false);
  });
  it('does not migrate or clear operator offline work from the shared guide worker', async () => {
    for (const name of ['migrateLegacyQueue','invalidateLegacyAuthContext']) {
      const openLegacyDb=vi.fn();
      await sourceFunction('public/guide/sw.js',name,{SHARED_GUIDE:true,openLegacyDb})();
      expect(openLegacyDb).not.toHaveBeenCalled();
    }
  });
});
