// this is https://npmjs.com/yocto-queue and https://npmjs.com/p-limit
// bundled together for ease of use

/*
How it works:
`this.#head` is an instance of `Node` which keeps track of its current value and nests another instance of `Node` that keeps the value that comes after it. When a value is provided to `.enqueue()`, the code needs to iterate through `this.#head`, going deeper and deeper to find the last value. However, iterating through every single item is slow. This problem is solved by saving a reference to the last value as `this.#tail` so that it can reference it to add a new value.
*/

class Node {
  value;
  next;

  constructor(value) {
    this.value = value;
  }
}

export class Queue {
  #head;
  #tail;
  #size;

  constructor() {
    this.clear();
  }

  enqueue(value) {
    const node = new Node(value);

    if (this.#head) {
      this.#tail.next = node;
      this.#tail = node;
    } else {
      this.#head = node;
      this.#tail = node;
    }

    this.#size++;
  }

  dequeue() {
    const current = this.#head;
    if (!current) {
      return;
    }

    this.#head = this.#head.next;
    this.#size--;
    return current.value;
  }

  clear() {
    this.#head = undefined;
    this.#tail = undefined;
    this.#size = 0;
  }

  get size() {
    return this.#size;
  }

  *[Symbol.iterator]() {
    let current = this.#head;

    while (current) {
      yield current.value;
      current = current.next;
    }
  }
}

export function pLimit(concurrency) {
  if (
    !(
      (Number.isInteger(concurrency) ||
        concurrency === Number.POSITIVE_INFINITY) &&
      concurrency > 0
    )
  ) {
    throw new TypeError("Expected `concurrency` to be a number from 1 and up");
  }

  const queue = new Queue();
  let activeCount = 0;

  const next = () => {
    activeCount--;

    if (queue.size > 0) {
      queue.dequeue()();
    }
  };

  const run = async (fn, resolve, args) => {
    activeCount++;

    const result = (async () => fn(...args))();

    resolve(result);

    try {
      await result;
    } catch {}

    next();
  };

  const enqueue = (fn, resolve, args) => {
    queue.enqueue(run.bind(undefined, fn, resolve, args));

    (async () => {
      // This function needs to wait until the next microtask before comparing
      // `activeCount` to `concurrency`, because `activeCount` is updated asynchronously
      // when the run function is dequeued and called. The comparison in the if-statement
      // needs to happen asynchronously as well to get an up-to-date value for `activeCount`.
      await Promise.resolve();

      if (activeCount < concurrency && queue.size > 0) {
        queue.dequeue()();
      }
    })();
  };

  const generator = (fn, ...args) =>
    new Promise((resolve) => {
      enqueue(fn, resolve, args);
    });

  Object.defineProperties(generator, {
    activeCount: {
      get: () => activeCount,
    },
    pendingCount: {
      get: () => queue.size,
    },
    clearQueue: {
      value: () => {
        queue.clear();
      },
    },
  });

  return generator;
}
