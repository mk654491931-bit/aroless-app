#!/usr/bin/env tsx
/**
 * AI Router Test Betiği
 *
 * Kullanım:
 *   npx tsx scripts/test-router.ts              # gerçek API çağrısı (key gerektirir)
 *   npx tsx scripts/test-router.ts --dry-run    # key envanteri + routing tablosu
 *   DRY_RUN=1 npx tsx scripts/test-router.ts
 *
 * Not: gerçek mod için .env.local dosyasında key'ler tanımlı olmalıdır.
 */

// dotenv yükleme (varsa)
try {
  const { config } = await import('dotenv');
  config({ path: '.env.local' });
} catch { /* dotenv yoksa yoksay */ }

import { callSmartRouter, type TaskType } from '../src/lib/ai-router/index.js';
import {
  loadProviderKeys,
  PROVIDER_CONFIGS,
  ROUTING_PRIORITY,
  type ProviderId,
} from '../src/lib/ai-router/config.js';

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

const isDryRun =
  process.env['DRY_RUN'] === '1' || process.argv.includes('--dry-run');

const LINE = '─'.repeat(64);

function section(title: string): void {
  console.log(`\n${LINE}`);
  console.log(`  ${title}`);
  console.log(LINE);
}

// ---------------------------------------------------------------------------
// Envanter raporu
// ---------------------------------------------------------------------------

function printInventory(): void {
  section('📦  API Key Envanteri');
  const all = loadProviderKeys();
  const ids = Object.keys(all) as ProviderId[];
  let totalKeys = 0;

  for (const id of ids) {
    const keys = all[id] ?? [];
    totalKeys += keys.length;
    const ok    = keys.length > 0;
    const badge = ok ? '✅' : '❌ EKSİK';
    const preview = keys
      .map((k, i) => `K${i + 1}:${k.slice(0, 8)}…`)
      .join('  ');
    console.log(
      `  ${badge} ${id.padEnd(14)} ${String(keys.length).padStart(1)} key   ${preview}`,
    );
  }
  console.log(`\n  Toplam: ${totalKeys} / 22 key tanımlı`);
}

// ---------------------------------------------------------------------------
// Routing tablosu
// ---------------------------------------------------------------------------

function printRoutingTable(): void {
  section('🗺️  Routing Öncelikleri');
  const tasks = Object.keys(ROUTING_PRIORITY) as TaskType[];
  for (const task of tasks) {
    const chain = ROUTING_PRIORITY[task].join(' → ');
    console.log(`  ${task.padEnd(8)}: ${chain}`);
  }
}

// ---------------------------------------------------------------------------
// Tek görev testi
// ---------------------------------------------------------------------------

async function runTest(taskType: TaskType, prompt: string): Promise<boolean> {
  section(`🚀  Test: taskType="${taskType}"`);
  console.log(`  Prompt : ${prompt}\n`);

  if (isDryRun) {
    const all      = loadProviderKeys();
    const priority = ROUTING_PRIORITY[taskType];
    const first    = priority.find((p) => (all[p]?.length ?? 0) > 0);
    if (first) {
      console.log(`  [DRY-RUN] İlk uygun provider : ${first}`);
      console.log(`  [DRY-RUN] Model              : ${PROVIDER_CONFIGS[first].model}`);
      console.log(`  [DRY-RUN] Gerçek API çağrısı atlandı.`);
    } else {
      console.log(`  [DRY-RUN] ❌ Bu taskType için hiç key bulunamadı!`);
      return false;
    }
    return true;
  }

  try {
    const result = await callSmartRouter({
      prompt,
      taskType,
      maxTokens: 120,
      temperature: 0.3,
    });
    console.log(`  ✅ Provider  : ${result.provider}  (key #${result.keyIndex})`);
    console.log(`  ✅ Model     : ${result.model}`);
    console.log(`  ✅ Gecikme   : ${result.latencyMs} ms`);
    console.log(`  ✅ Yanıt     : ${result.text.slice(0, 300)}${
      result.text.length > 300 ? '…' : ''
    }`);
    return true;
  } catch (err: unknown) {
    console.error(`  ❌ HATA: ${
      err instanceof Error ? err.message : String(err)
    }`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Ana betik
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('\n🤖  Aroless Multi-Provider AI Router — Test Başlıyor');
  console.log(isDryRun ? '  Mod: DRY-RUN (gerçek çağrı yok)' : '  Mod: LIVE');

  printInventory();
  printRoutingTable();

  const tests: Array<[TaskType, string]> = [
    ['fast',    'Merhaba! Bir cümlede kendini tanıt.'],
    ['complex', 'E-ticaret nihai kullanıcı davranışları üzerine kısa bir analiz yap.'],
    ['default', 'Dropshipping için 3 trend ürün kategori öner.'],
  ];

  let passed = 0;
  for (const [taskType, prompt] of tests) {
    const ok = await runTest(taskType, prompt);
    if (ok) passed++;
  }

  section('📊  Test Özeti');
  console.log(`  Geçen : ${passed} / ${tests.length}`);
  if (passed < tests.length) {
    console.log('  ⚠️  Bazı testler başarısız. Vercel ortam değişkenlerini kontrol edin.');
    process.exit(1);
  }
  console.log('  Tüm testler başarıyla geçti. ✨\n');
}

main().catch((err: unknown) => {
  console.error('\n❌  Test betiği beklenmedik hatayla çöktü:', err);
  process.exit(1);
});
