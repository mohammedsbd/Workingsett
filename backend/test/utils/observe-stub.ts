/**
 * Jest stand-in for @nestjs/observe. The package ships as ES modules only,
 * which Jest's CommonJS runtime cannot load, and Observe never runs in
 * tests anyway (OBSERVE_ENABLED is false when NODE_ENV=test). Mapped in the
 * Jest configs with moduleNameMapper; the app itself uses the real package.
 */
class ObserveModuleStub {
  static forRoot(): never {
    throw new Error('NestJS Observe is not available in tests');
  }
}

export function createObserveModule() {
  return { ObserveModule: ObserveModuleStub, ObserveInstrument: undefined };
}
