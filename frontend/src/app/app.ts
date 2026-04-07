import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { TeaService, Tea, Blend } from './tea.service';

@Component({
  selector: 'app-root',
  imports: [CommonModule, FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App implements OnInit {
  private teaService = inject(TeaService);

  allTeas = signal<Tea[]>([]);
  searchQuery = signal('');
  selectedTeas = signal<Tea[]>([]);
  blend = signal<Blend | null>(null);

  filteredTeas = computed(() => {
    const q = this.searchQuery().toLowerCase();
    if (!q) return this.allTeas();
    return this.allTeas().filter(t =>
      t.NAME.toLowerCase().includes(q) || t.DESCRIPTION.toLowerCase().includes(q)
    );
  });

  ngOnInit() {
    this.teaService.getTeas().subscribe(teas => this.allTeas.set(teas));
  }

  isSelected(tea: Tea): boolean {
    return this.selectedTeas().some(t => t.ID === tea.ID);
  }

  toggleTea(tea: Tea) {
    const current = this.selectedTeas();
    if (this.isSelected(tea)) {
      this.selectedTeas.set(current.filter(t => t.ID !== tea.ID));
    } else {
      if (current.length >= 3) return;
      this.selectedTeas.set([...current, tea]);
    }
    this.updateBlend();
  }

  removeTea(tea: Tea) {
    this.selectedTeas.update(teas => teas.filter(t => t.ID !== tea.ID));
    this.updateBlend();
  }

  private updateBlend() {
    const ids = this.selectedTeas().map(t => t.ID);
    if (ids.length === 0) {
      this.blend.set(null);
      return;
    }
    this.teaService.getBlend(ids).subscribe(blend => this.blend.set(blend));
  }

  qualityClass(quality: string): string {
    switch (quality?.toLowerCase()) {
      case 'positive': return 'effect-positive';
      case 'negative': return 'effect-negative';
      default: return 'effect-neutral';
    }
  }
}
