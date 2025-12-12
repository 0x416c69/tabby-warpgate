/**
 * Mock for @angular/core
 * Provides minimal implementations for testing
 */

// Decorator factories that return pass-through decorators
export function Injectable(_options?: any): ClassDecorator {
  return function (target: any) {
    return target;
  };
}

export function Inject(_token?: any): ParameterDecorator {
  return function (_target: any, _propertyKey: string | symbol | undefined, _parameterIndex: number) {
    // No-op decorator
  };
}

export function Optional(): ParameterDecorator {
  return function (_target: any, _propertyKey: string | symbol | undefined, _parameterIndex: number) {
    // No-op decorator
  };
}

export function Component(_options?: any): ClassDecorator {
  return function (target: any) {
    return target;
  };
}

export function NgModule(_options?: any): ClassDecorator {
  return function (target: any) {
    return target;
  };
}

export function Input(_bindingPropertyName?: string): PropertyDecorator {
  return function (_target: any, _propertyKey: string | symbol) {
    // No-op decorator
  };
}

export function Output(_bindingPropertyName?: string): PropertyDecorator {
  return function (_target: any, _propertyKey: string | symbol) {
    // No-op decorator
  };
}

export function ViewChild(_selector: any, _opts?: any): PropertyDecorator {
  return function (_target: any, _propertyKey: string | symbol) {
    // No-op decorator
  };
}

// Injection token mock
export class InjectionToken<T> {
  constructor(public _desc: string, _options?: any) {}
}

// EventEmitter mock
export class EventEmitter<T> {
  private handlers: Array<(value: T) => void> = [];

  emit(value: T): void {
    this.handlers.forEach(handler => handler(value));
  }

  subscribe(handler: (value: T) => void): { unsubscribe: () => void } {
    this.handlers.push(handler);
    return {
      unsubscribe: () => {
        const index = this.handlers.indexOf(handler);
        if (index > -1) {
          this.handlers.splice(index, 1);
        }
      },
    };
  }
}

// OnInit, OnDestroy interfaces
export interface OnInit {
  ngOnInit(): void;
}

export interface OnDestroy {
  ngOnDestroy(): void;
}

export interface AfterViewInit {
  ngAfterViewInit(): void;
}

// ChangeDetectorRef mock
export class ChangeDetectorRef {
  markForCheck(): void {}
  detectChanges(): void {}
  detach(): void {}
  reattach(): void {}
  checkNoChanges(): void {}
}

// ElementRef mock
export class ElementRef<T = any> {
  nativeElement: T;
  constructor(nativeElement: T) {
    this.nativeElement = nativeElement;
  }
}

// NgZone mock
export class NgZone {
  run<T>(fn: (...args: any[]) => T): T {
    return fn();
  }
  runOutsideAngular<T>(fn: (...args: any[]) => T): T {
    return fn();
  }
}
