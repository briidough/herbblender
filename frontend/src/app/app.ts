import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TeaService, Tea, Blend, Effect, Plant } from './tea.service';

const EFFECT_MOOD_MAP: Record<string, string> = {
  'Natural Energy':           'effect-energizing',
  'Focus & Clarity':          'effect-energizing',
  'Metabolic Support':        'effect-energizing',
  'Mood Balance':             'effect-energizing',
  'Antidepressant':           'effect-energizing',
  'Sweetening Agent':         'effect-energizing',
  'Relaxation & Calm':        'effect-calming',
  'Stress Reduction':         'effect-calming',
  'Aid Sleep':                'effect-calming',
  'Anxiolytic':               'effect-calming',
  'Sedative':                 'effect-calming',
  'Adaptogenic Support':      'effect-calming',
  'Antioxidant':              'effect-protective',
  'Anti-inflammatory':        'effect-protective',
  'Cell Protection':          'effect-protective',
  'Neuroprotective':          'effect-protective',
  'Antimicrobial':            'effect-protective',
  'Antiviral Support':        'effect-protective',
  'Immune Support':           'effect-protective',
  'Cardiovascular Support':   'effect-supportive',
  'Blood Pressure Regulation':'effect-supportive',
  'Blood Sugar Regulation':   'effect-supportive',
  'Cholesterol Reduction':    'effect-supportive',
  'Respiratory Support':      'effect-supportive',
  'Liver Support':            'effect-supportive',
  'Ease Digestion':           'effect-supportive',
  'Gut Health':               'effect-supportive',
  'Detox Support':            'effect-supportive',
  'Hydration & Refreshment':  'effect-supportive',
  'Astringent':               'effect-supportive',
};

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
  detailPlant = signal<Plant | null>(null);
  blendLoading = signal(false);
  detailLoading = signal(false);
  selectedEffectFilter = signal<string>('');

  allEffectNames = computed<string[]>(() =>
    [...new Set(this.allTeas().flatMap(t => t.EFFECT_NAMES))].sort()
  );

  filteredTeas = computed<Tea[]>(() => {
    const filter = this.selectedEffectFilter();
    if (!filter) return this.allTeas();
    return this.allTeas().filter(t => t.EFFECT_NAMES.includes(filter));
  });

  effectCounts = computed(() => {
    const b = this.blend();
    if (!b) return new Map<string, number>();
    const counts = new Map<string, number>();
    for (const tea of b.teas) {
      for (const effect of (tea.EFFECTS ?? [])) {
        counts.set(effect.ID, (counts.get(effect.ID) ?? 0) + 1);
      }
    }
    return counts;
  });

  ngOnInit() {
    this.teaService.getTeas().subscribe(teas =>
      this.allTeas.set(teas.sort((a, b) => a.NAME.localeCompare(b.NAME)))
    );
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
    this.selectedEffectFilter.set('');
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
    event.stopPropagation(); /* ope forgot commit comment*/
    this.detailTea.set(tea);
    this.detailEffects.set([]);
    this.detailPlant.set(null);
    this.detailLoading.set(true);
    this.showDetailOverlay.set(true);
    this.teaService.getBlend([tea.ID]).subscribe(blend => {
      this.detailEffects.set(blend.effects);
      this.detailLoading.set(false);
    });
    this.teaService.getTeaPlant(tea.ID).subscribe(plant => {
      this.detailPlant.set(plant);
    });
  }

  closeDetailOverlay() {
    this.showDetailOverlay.set(false);
    this.detailTea.set(null);
    this.detailEffects.set([]);
    this.detailPlant.set(null);
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

  sharedClass(effectId: string): string {
    const count = this.effectCounts().get(effectId) ?? 0;
    if (count >= 3) return 'effect-shared-3';
    if (count >= 2) return 'effect-shared-2';
    return '';
  }

  moodClass(name: string): string {
    return EFFECT_MOOD_MAP[name] ?? 'effect-supportive';
  }
}
