// wix-crm.v2: tasks.createTask, recorded (state.failures: refused before Wix takes it, or once it
// did), each with its creation date, refused as Wix documents it past its limits (title 1 to 250
// characters, description 1 to 500, the contact's id a GUID); tasks.queryTasks, with the filters
// Wix's TasksQueryBuilder has that the plugin uses (ge on _createdDate, eq on contact.id), newest
// first, 50 by default.
import { checkGuid, checkLength, maybeFail, state } from "./state.mjs";

function query() {
  const filters = [];
  let max = 50;
  const builder = {
    ge(field, value) {
      if (field !== "_createdDate") throw new Error(`queryTasks: ge on ${field}`);
      const from = new Date(value).getTime();
      filters.push((task) => new Date(task._createdDate).getTime() >= from);
      return builder;
    },
    eq(field, value) {
      if (field !== "contact.id") throw new Error(`queryTasks: eq on ${field}`);
      filters.push((task) => !!task.contact && task.contact._id === value);
      return builder;
    },
    limit(n) {
      max = n;
      return builder;
    },
    async find() {
      maybeFail("queryTasks");
      const items = state.tasks
        .filter((task) => filters.every((f) => f(task)))
        .sort((a, b) => new Date(b._createdDate).getTime() - new Date(a._createdDate).getTime())
        .slice(0, max);
      return { items: JSON.parse(JSON.stringify(items)) };
    }
  };
  return builder;
}

export const tasks = {
  async createTask(task) {
    const late = maybeFail("createTask");
    if (task.title !== undefined) checkLength("task.title", task.title, 250, 1);
    if (task.description !== undefined) checkLength("task.description", task.description, 500, 1);
    if (task.contact) checkGuid("task.contact.id", task.contact._id);
    const created = JSON.parse(
      JSON.stringify(
        Object.assign(
          { _id: `task-${state.tasks.length + 1}`, _createdDate: new Date(Date.now()) },
          task
        )
      )
    );
    state.tasks.push(created);
    if (late) late();
    return created;
  },
  queryTasks() {
    return query();
  }
};
