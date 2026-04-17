import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface Effect {
  ID: string;
  NAME: string;
  DESCRIPTION: string;
  QUALITY: string;
}

export interface Tea {
  ID: string;
  NAME: string;
  DESCRIPTION: string;
  OXIDATION: string;
  FERMENTATION: string;
  GENUS: string;
  SPECIES: string;
  FAMILY: string;
  ALKALOIDS: string[];
  IMAGE_PATH?: string | null;
  EFFECTS?: Effect[];
}

export interface Blend {
  teas: Tea[];
  effects: Effect[];
}

export interface Plant {
  NAME: string;
  GENUS: string;
  SPECIES: string;
  FAMILY: string;
  DESCRIPTION: string;
  NATIVE_RANGE: string[];
  IMAGE_PATH?: string | null;
}

@Injectable({ providedIn: 'root' })
export class TeaService {
  private http = inject(HttpClient);

  getTeas(): Observable<Tea[]> {
    return this.http.get<Tea[]>('/api/teas');
  }

  getBlend(ids: string[]): Observable<Blend> {
    return this.http.get<Blend>(`/api/blend?ids=${ids.join(',')}`);
  }

  getTeaPlant(teaId: string): Observable<Plant> {
    return this.http.get<Plant>(`/api/teas/${teaId}/plant`);
  }
}
