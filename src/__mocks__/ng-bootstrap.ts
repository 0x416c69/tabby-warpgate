/**
 * Mock for @ng-bootstrap/ng-bootstrap
 */

export class NgbModal {
  open(content: any, options?: any): any {
    return {
      componentInstance: {},
      result: Promise.resolve('mocked-result'),
      dismiss: jest.fn(),
      close: jest.fn(),
    };
  }
}

export class NgbModalRef {
  componentInstance: any = {};
  result: Promise<any> = Promise.resolve();
  dismiss = jest.fn();
  close = jest.fn();
}

export class NgbActiveModal {
  close = jest.fn();
  dismiss = jest.fn();
}

export const NgbModalModule = {
  forRoot: () => ({ ngModule: NgbModalModule }),
};
