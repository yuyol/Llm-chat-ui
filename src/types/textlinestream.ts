export interface TextLineStreamOptions {
  allowCR?: boolean;
  returnEmptyLines?: boolean;
  mapperFun?: (line: string) => string;
}

export class TextLineStream extends TransformStream<string, string> {
  #buf: string = "";
  #allowCR: boolean = false;
  #returnEmptyLines: boolean = false;
  #mapperFun: (line: string) => string = (line) => line;

  constructor(options?: TextLineStreamOptions) {
    super({
      transform: (chunk, controller) => this.#handle(chunk, controller),
      flush: (controller) => this.#handle("\r\n", controller),
    });

    this.#allowCR = options?.allowCR ?? false;
    this.#returnEmptyLines = options?.returnEmptyLines ?? false;
    this.#mapperFun = options?.mapperFun ?? ((line) => line);
  }

  #handle(chunk: string, controller: TransformStreamDefaultController<string>) {
    chunk = this.#buf + chunk;

    while (true) {
      const lfIndex = chunk.indexOf("\n");

      if (this.#allowCR) {
        const crIndex = chunk.indexOf("\r");

        if (
          crIndex !== -1 &&
          crIndex !== chunk.length - 1 &&
          (lfIndex === -1 || lfIndex - 1 > crIndex)
        ) {
          const curChunk = this.#mapperFun(chunk.slice(0, crIndex));
          if (this.#returnEmptyLines || curChunk) {
            controller.enqueue(curChunk);
          }
          chunk = chunk.slice(crIndex + 1);
          continue;
        }
      }

      if (lfIndex !== -1) {
        let crOrLfIndex = lfIndex;
        if (chunk[lfIndex - 1] === "\r") {
          crOrLfIndex--;
        }
        const curChunk = this.#mapperFun(chunk.slice(0, crOrLfIndex));
        if (this.#returnEmptyLines || curChunk) {
          controller.enqueue(curChunk);
        }
        chunk = chunk.slice(lfIndex + 1);
        continue;
      }

      break;
    }

    this.#buf = chunk;
  }
}

export default TextLineStream;
