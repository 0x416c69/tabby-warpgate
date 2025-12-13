/**
 * OTP Input Modal Component
 * Modal dialog for prompting user to enter OTP code
 */

import { Component, Input } from '@angular/core';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';

@Component({
  selector: 'warpgate-otp-modal',
  template: `
    <div class="modal-header">
      <h4 class="modal-title">OTP Required</h4>
      <button type="button" class="btn-close" aria-label="Close" (click)="cancel()"></button>
    </div>
    <div class="modal-body">
      <p>Enter the OTP code for <strong>{{ serverName }}</strong>:</p>
      <input
        type="text"
        class="form-control"
        [(ngModel)]="otpCode"
        placeholder="Enter 6-digit code"
        maxlength="6"
        pattern="[0-9]{6}"
        autofocus
        (keyup.enter)="submit()"
      />
    </div>
    <div class="modal-footer">
      <button type="button" class="btn btn-secondary" (click)="cancel()">Cancel</button>
      <button
        type="button"
        class="btn btn-primary"
        (click)="submit()"
        [disabled]="!isValidOtp()"
      >
        Submit
      </button>
    </div>
  `,
  styles: [`
    .form-control {
      font-size: 1.2em;
      text-align: center;
      letter-spacing: 0.5em;
      font-family: monospace;
    }
  `]
})
export class WarpgateOtpModalComponent {
  @Input() serverName = '';
  otpCode = '';

  constructor(public activeModal: NgbActiveModal) {}

  isValidOtp(): boolean {
    return /^[0-9]{6}$/.test(this.otpCode);
  }

  submit(): void {
    if (this.isValidOtp()) {
      this.activeModal.close(this.otpCode);
    }
  }

  cancel(): void {
    this.activeModal.dismiss();
  }
}
