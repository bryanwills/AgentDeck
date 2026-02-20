import { EventEmitter } from 'events';
import { spawn, type ChildProcess } from 'child_process';
import { tmpdir, homedir } from 'os';
import { join } from 'path';
import { unlinkSync, existsSync, statSync } from 'fs';
import { debug } from './logger.js';

const WHISPER_TIMEOUT_MS = 60_000;

// Preferred model order: base is fast, small is better quality, large is slow
const MODEL_PREFERENCE = [
  'ggml-base.bin',
  'ggml-small.bin',
  'ggml-large-v3-turbo.bin',
];

function findWhisperModel(modelName: string): string {
  const searchDirs = [
    join(homedir(), '.local/share/whisper-cpp'),
    '/usr/local/share/whisper-cpp',
    join(homedir(), 'models'),
  ];

  // First try exact requested model
  for (const dir of searchDirs) {
    const path = join(dir, modelName);
    if (existsSync(path)) {
      debug('Voice', `Found whisper model: ${path}`);
      return path;
    }
  }

  // Fall back to any available model in preference order
  for (const model of MODEL_PREFERENCE) {
    for (const dir of searchDirs) {
      const path = join(dir, model);
      if (existsSync(path)) {
        debug('Voice', `Fallback whisper model: ${path}`);
        return path;
      }
    }
  }

  debug('Voice', `No whisper model found in: ${searchDirs.join(', ')}`);
  return join(searchDirs[0], modelName);
}

export class VoiceManager extends EventEmitter {
  private recording = false;
  private audioProcess: ChildProcess | null = null;
  private audioFile = '';
  private whisperModel: string;

  constructor(whisperModel = 'ggml-base.bin') {
    super();
    this.whisperModel = findWhisperModel(whisperModel);
  }

  startRecording(): void {
    if (this.recording) return;

    this.audioFile = join(tmpdir(), `sdc-voice-${Date.now()}.wav`);
    this.recording = true;

    // rec (sox) — record to WAV. We request 16kHz mono 16-bit.
    // If macOS can't do 16kHz, sox will record at native rate (48kHz)
    // and we'll let whisper handle resampling.
    this.audioProcess = spawn('rec', [
      '-r', '16000',
      '-c', '1',
      '-b', '16',
      this.audioFile,
    ], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    this.audioProcess.stderr?.on('data', (data: Buffer) => {
      const line = data.toString().trim();
      // Only log non-progress lines
      if (line && !line.startsWith('In:') && !line.startsWith('Out:')) {
        debug('Voice', `rec: ${line}`);
      }
    });

    this.audioProcess.on('error', (err) => {
      debug('Voice', `rec spawn error: ${err.message}`);
      this.recording = false;
      this.audioProcess = null;
      this.emit('error', new Error(`Failed to start recording: ${err.message}`));
    });

    this.audioProcess.on('exit', (code) => {
      debug('Voice', `rec exited with code ${code}`);
      this.audioProcess = null;
    });

    this.emit('recording_start');
    debug('Voice', `Recording started → ${this.audioFile}`);
  }

  async stopRecording(): Promise<string> {
    if (!this.recording || !this.audioProcess) {
      throw new Error('Not currently recording');
    }

    const proc = this.audioProcess;
    this.recording = false;
    this.emit('recording_stop');

    proc.kill('SIGINT');
    debug('Voice', 'Sent SIGINT to rec');

    // Wait for exit (up to 3s)
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      proc.on('exit', finish);
      setTimeout(finish, 3000);
    });

    // Verify file
    if (!existsSync(this.audioFile)) {
      this.cleanup();
      throw new Error(`Recording file not created: ${this.audioFile}`);
    }
    const sz = statSync(this.audioFile).size;
    debug('Voice', `Recording file: ${sz} bytes`);
    if (sz < 100) {
      this.cleanup();
      throw new Error('Recording too short or empty');
    }

    // Resample to 16kHz/16-bit mono WAV (macOS coreaudio may record at 48kHz/32-bit)
    const resampledFile = this.audioFile.replace('.wav', '_16k.wav');
    debug('Voice', `Resampling ${this.audioFile} → ${resampledFile}`);
    try {
      await this.resample(this.audioFile, resampledFile);
    } catch (err) {
      debug('Voice', `Resample failed, using original: ${err}`);
      // Fall through — use original file if sox resample fails
    }
    const whisperInput = existsSync(resampledFile) ? resampledFile : this.audioFile;
    debug('Voice', `Whisper input: ${whisperInput}`);

    // Transcribe
    debug('Voice', 'Starting whisper transcription...');
    try {
      const text = await this.transcribe(whisperInput);
      debug('Voice', `Transcription result: "${text.slice(0, 80)}"`);
      this.emit('transcription', text);
      this.cleanup();
      if (existsSync(resampledFile)) try { unlinkSync(resampledFile); } catch { /* */ }
      return text;
    } catch (err) {
      this.cleanup();
      if (existsSync(resampledFile)) try { unlinkSync(resampledFile); } catch { /* */ }
      const error = err instanceof Error ? err : new Error(String(err));
      debug('Voice', `Transcription error: ${error.message}`);
      this.emit('error', error);
      throw error;
    }
  }

  cancel(): void {
    if (this.audioProcess) {
      this.audioProcess.kill('SIGKILL');
      this.audioProcess = null;
    }
    this.recording = false;
    this.cleanup();
    this.emit('recording_stop');
  }

  isRecording(): boolean {
    return this.recording;
  }

  private resample(inputFile: string, outputFile: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const sox = spawn('sox', [
        inputFile,
        '-r', '16000',
        '-c', '1',
        '-b', '16',
        outputFile,
      ]);

      let stderr = '';
      sox.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });

      sox.on('error', (err) => reject(new Error(`sox spawn error: ${err.message}`)));
      sox.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`sox exited with code ${code}: ${stderr.slice(-200)}`));
        } else {
          debug('Voice', `Resampled OK (${statSync(outputFile).size} bytes)`);
          resolve();
        }
      });
    });
  }

  private transcribe(audioFile: string): Promise<string> {
    return new Promise((resolve, reject) => {
      debug('Voice', `whisper-cli -m ${this.whisperModel} -l ko -f ${audioFile} --no-timestamps`);

      const whisper = spawn('whisper-cli', [
        '-m', this.whisperModel,
        '-l', 'ko',
        '-f', audioFile,
        '--no-timestamps',
        '-np',  // suppress whisper's own progress output
      ]);

      let stdout = '';
      let stderr = '';
      let settled = false;

      // Timeout guard
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          debug('Voice', 'whisper-cli timed out, killing');
          whisper.kill('SIGKILL');
          reject(new Error(`whisper-cli timed out after ${WHISPER_TIMEOUT_MS / 1000}s`));
        }
      }, WHISPER_TIMEOUT_MS);

      whisper.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      whisper.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      whisper.on('error', (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          debug('Voice', `whisper-cli spawn error: ${err.message}`);
          reject(new Error(`Failed to run whisper-cli: ${err.message}`));
        }
      });

      whisper.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);

        debug('Voice', `whisper-cli exited with code ${code}`);
        if (stderr.length > 0) {
          debug('Voice', `whisper stderr (last 200): ${stderr.slice(-200)}`);
        }

        if (code !== 0) {
          reject(new Error(`whisper-cli exited with code ${code}: ${stderr.slice(-300)}`));
          return;
        }

        const text = stdout
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0 && !line.startsWith('['))  // skip timestamp lines
          .join(' ')
          .trim();

        debug('Voice', `whisper stdout raw (${stdout.length} chars): "${stdout.slice(0, 100)}"`);
        resolve(text);
      });
    });
  }

  private cleanup(): void {
    if (this.audioFile && existsSync(this.audioFile)) {
      try { unlinkSync(this.audioFile); } catch { /* */ }
    }
    this.audioFile = '';
  }
}
