import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface Effect {
  ID: number;
  NAME: string;
  DESCRIPTION: string;
  QUALITY: string;
}

export interface Tea {
  ID: number;
  NAME: string;
  DESCRIPTION: string;
  HERB_ID: number;
  OXIDATION: string;
  EFFECTS?: Effect[];
}

export interface Blend {
  teas: Tea[];
  effects: Effect[];
}

@Injectable({ providedIn: 'root' })
export class TeaService {
  private http = inject(HttpClient);

  getTeas(): Observable<Tea[]> {
    return this.http.get<Tea[]>('/api/teas');
  }

  getBlend(ids: number[]): Observable<Blend> {
    return this.http.get<Blend>(`/api/blend?ids=${ids.join(',')}`);
  }
}
