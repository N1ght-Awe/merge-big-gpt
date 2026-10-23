import type { LevelConfig } from './types';

const assets = `${import.meta.env?.BASE_URL ?? '/'}assets/characters/repaired-v1/`;

/** Replace image paths here to install final transparent PNG artwork. */
export const LEVELS: LevelConfig[] = [
  { id: 1, name: '对话泡泡', radius: 20, color: '#F0F5EE', accent: '#A0B493', image: `${assets}01_dialog.png`, quip: '你好，有什么可以帮你？', score: 2 },
  { id: 2, name: '迷你龙娘', radius: 27, color: '#F4F2EB', accent: '#BBAE92', image: `${assets}02_mini.png`, quip: '正在长出一点点智能…', score: 4 },
  { id: 3, name: '呆萌龙娘', radius: 34, color: '#FCF0E8', accent: '#C9A890', image: `${assets}03_cuddly.png`, quip: '可爱，也是生产力！', score: 8 },
  { id: 4, name: '摸鱼龙娘', radius: 41, color: '#EDF5F1', accent: '#95B5A7', image: `${assets}04_fishing.png`, quip: '正在思考（其实在摸鱼）', score: 16 },
  { id: 5, name: '思考龙娘', radius: 49, color: '#EEF2F6', accent: '#A3B1C2', image: `${assets}05_thinking.png`, quip: '让我再想亿小会儿…', score: 32 },
  { id: 6, name: '别催龙娘', radius: 58, color: '#F9EFED', accent: '#C8A8A0', image: `${assets}06_impatient.png`, quip: '别催，Token 正在路上！', score: 64 },
  { id: 7, name: '工作龙娘', radius: 68, color: '#F8F3E6', accent: '#BDAA7B', image: `${assets}07_work.png`, quip: '收到，这就帮你写！', score: 128 },
  { id: 8, name: '分析龙娘', radius: 79, color: '#ECF4F5', accent: '#94B1B6', image: `${assets}08_analysis.png`, quip: '发现了一个关键问题：你好可爱。', score: 256 },
  { id: 9, name: '老师龙娘', radius: 91, color: '#F2F4E9', accent: '#ADB790', image: `${assets}09_teacher.png`, quip: '这个知识点，龙娘要考！', score: 512 },
  { id: 10, name: '华丽龙娘', radius: 105, color: '#F8F3E9', accent: '#C2AD81', image: `${assets}10_elegant.png`, quip: '推理完成，优雅登场 ✧', score: 1024 },
  { id: 11, name: '伟大的 GPT 龙娘大人', radius: 121, color: '#FBF3DC', accent: '#C4A057', image: `${assets}11_great.png`, quip: '上下文无限，龙娘万岁！', score: 2048 },
];

export const GAME = {
  width: 440,
  height: 620,
  wall: 12,
  floorY: 604,
  spawnY: 48,
  deadline: 126,
  dropCooldown: 500,
  comboWindow: 1800,
} as const;

