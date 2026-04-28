import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { PrefillComponent } from './prefill.component';

describe('PrefillComponent', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [PrefillComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('loads sparten on init', () => {
    const fixture = TestBed.createComponent(PrefillComponent);
    fixture.detectChanges();
    const req = httpMock.expectOne('/api/prefill/sparten');
    expect(req.request.method).toBe('GET');
    req.flush([{ key: 'Kfz', label: 'KFZ-Versicherung' }]);
    fixture.detectChanges();
    const html = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(html).toContain('Kfz');
  });

  it('posts to /validate and shows the OK banner', () => {
    const fixture = TestBed.createComponent(PrefillComponent);
    fixture.detectChanges();
    httpMock
      .expectOne('/api/prefill/sparten')
      .flush([{ key: 'Kfz', label: 'KFZ-Versicherung' }]);

    const cmp = fixture.componentInstance as unknown as {
      sparte: { set: (s: string) => void };
      json: { set: (s: string) => void };
      validate: () => void;
    };
    cmp.sparte.set('Kfz');
    cmp.json.set('{"sparte":"Kfz"}');
    cmp.validate();

    const req = httpMock.expectOne('/api/prefill/validate');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      sparte: 'Kfz',
      json: '{"sparte":"Kfz"}',
      stage: 'live',
    });
    req.flush({
      valid: true,
      errors: [],
      fieldCount: 1,
      cleanJson: '{"sparte":"Kfz"}',
      stage: 'live',
      schemaSource: 'live',
    });
    fixture.detectChanges();
    const html = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(html).toContain('All prefill data is valid');
  });
});
