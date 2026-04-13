import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TeaService, Tea, Blend, Effect, Herb } from './tea.service';

@Component({
  selector: 'app-root',
  imports: [CommonModule],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App implements OnInit {
  private teaService = inject(TeaService);

  allTeas = signal<Tea[]>([]);
  selectedTeas = signal<Tea[]>([]);
  blend = signal<Blend | null>(null);

  showSelectorOverlay = signal(false);
  showDetailOverlay = signal(false);
  detailTea = signal<Tea | null>(null);
  detailEffects = signal<Effect[]>([]);
  detailHerb = signal<Herb | null>(null);
  blendLoading = signal(false);
  detailLoading = signal(false);

  effectCounts = computed(() => {
    const b = this.blend();
    if (!b) return new Map<number, number>();
    const counts = new Map<number, number>();
    for (const tea of b.teas) {
      for (const effect of (tea.EFFECTS ?? [])) {
        counts.set(effect.ID, (counts.get(effect.ID) ?? 0) + 1);
      }
    }
    return counts;
  });

  ngOnInit() {
    this.teaService.getTeas().subscribe(teas => this.allTeas.set(teas));
  }

  isSelected(tea: Tea): boolean {
    return this.selectedTeas().some(t => t.ID === tea.ID);
  }

  openSelectorOverlay() {
    if (this.selectedTeas().length >= 3) return;
    this.showSelectorOverlay.set(true);
  }

  closeSelectorOverlay() {
    this.showSelectorOverlay.set(false);
    this.closeDetailOverlay();
  }

  addTea(tea: Tea) {
    const current = this.selectedTeas();
    if (current.length >= 3 || this.isSelected(tea)) return;
    this.selectedTeas.set([...current, tea]);
    this.updateBlend();
    this.closeSelectorOverlay();
  }

  removeTea(tea: Tea) {
    this.selectedTeas.update(teas => teas.filter(t => t.ID !== tea.ID));
    this.updateBlend();
  }

  openDetailOverlay(tea: Tea, event: MouseEvent) {
    event.stopPropagation();
    this.detailTea.set(tea);
    this.detailEffects.set([]);
    this.detailHerb.set(null);
    this.detailLoading.set(true);
    this.showDetailOverlay.set(true);
    this.teaService.getBlend([tea.ID]).subscribe(blend => {
      this.detailEffects.set(blend.effects);
      this.detailLoading.set(false);
    });
    this.teaService.getTeaHerb(tea.ID).subscribe(herb => {
      this.detailHerb.set(herb);
    });
  }

  closeDetailOverlay() {
    this.showDetailOverlay.set(false);
    this.detailTea.set(null);
    this.detailEffects.set([]);
    this.detailHerb.set(null);
  }

  onSelectorBackdropClick(event: MouseEvent) {
    if ((event.target as HTMLElement).classList.contains('overlay-backdrop')) {
      this.closeSelectorOverlay();
    }
  }

  onDetailBackdropClick(event: MouseEvent) {
    if ((event.target as HTMLElement).classList.contains('overlay-backdrop')) {
      this.closeDetailOverlay();
    }
  }

  private updateBlend() {
    const ids = this.selectedTeas().map(t => t.ID);
    if (ids.length === 0) {
      this.blend.set(null);
      this.blendLoading.set(false);
      return;
    }
    this.blendLoading.set(true);
    this.teaService.getBlend(ids).subscribe(blend => {
      this.blend.set(blend);
      this.blendLoading.set(false);
    });
  }

  sharedClass(effectId: number): string {
    const count = this.effectCounts().get(effectId) ?? 0;
    if (count >= 3) return 'effect-shared-3';
    if (count >= 2) return 'effect-shared-2';
    return '';
  }

  qualityClass(quality: string): string {
    switch (quality?.toLowerCase()) {
      case 'positive': return 'effect-positive';
      case 'negative': return 'effect-negative';
      default: return 'effect-neutral';
    }
  }
}
