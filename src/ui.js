import inquirer from 'inquirer';
// Why does this the following work for inquirer-search-list but not here?
//import InputPrompt from 'inquirer/lib/prompts/input';
import inquirer_search_list from '@Juancito/inquirer-search-list';
import chalk from 'chalk';
import _ from 'lodash';

inquirer.registerPrompt('search-list', inquirer_search_list);

import { pick, undefined_default, separate_sentinels, rekey } from './util.js';
import { sqlite3_affinity } from './db.js';

//const ui = new inquirer.ui.BottomBar();

class StrictInput extends inquirer.prompt.prompts.input {
  filterInput(input) {
    if (!input) {
      return this.opt.default;
    }
    return input;
  }
}

inquirer.registerPrompt('strict-input', StrictInput);

function friendly_column_name(column) {
  return column.replace(/_/i, ' ');
}

function initial_menu(db_utils) {
  inquirer.prompt({
    type: 'search-list',
    name: 'table',
    message: 'Select a table to examine:',
    choices: db_utils.table_choices(),
  }).then(function (answer) {
    table_options(db_utils, answer.table);
  }).catch(function (error) {
    if (error.isTtyError) {
      console.error('Inquirer error: this TTY is not supported.');
    } else {
      console.error('Inquirer error:', error);
    }
  });
}

function escape(row_data) {
  if (typeof row_data === 'string') {
    return row_data.replace(/\//g, '\\/');
  }
  return row_data;
}

function input_parse(input, answers, output='') {
  if (!(typeof input === 'string')) {
    return input;
  }
  const special_index = input.search(/[\\\/]./);
  if (special_index === -1) {
    return output.concat(input);
  }
  const prefix = input.slice(0, special_index);
  if (input[special_index] === '\\') {
    return input_parse(
      input.slice(special_index + 2),
      answers,
      output.concat(prefix, (
        input[special_index + 1] === 'n'
        ? "\n"
        : input[special_index + 1]
      )),
    );
  }
  const remainder = input.slice(special_index + 1);
  const space_index = remainder.search(/\s/);
  const command = remainder.slice(0, (
    space_index > -1
    ? space_index
    : undefined
  )).toLowerCase();
  if (output === '' && prefix === ''
      && _.includes(['null', 'true', 'false'], command)) {
    if (command === 'null') {
      return null;
    }
    if (command === 'true') {
      return 1;
    }
    if (command === 'false') {
      return 0;
    }
  }
  return input_parse(remainder, answers, output.concat(
    prefix,
    input[special_index],
  ));
}

// `row_answers` (answers from inquirer about editing a row) can contain
// foreign key information.  This function folds that foreign key information
// back into the answers object.
function rekey_from_fkrs(row_answers, fkrs, sentinel_ordering) {
  const merge_list = Object.entries(row_answers).reduce(
    function (list, entry) {
      const [ column_name, answer ] = entry;
      if (!sentinel_ordering.has(column_name)) {
        return list;
      }
      const fk_nr = sentinel_ordering.get(column_name);
      const keymap = _.zip(
        fkrs.getIn([fk_nr, 'to', 'columns']).toArray(),
        fkrs.getIn([fk_nr, 'from']).toArray(),
      );
      console.log(entry, keymap);
      list.push(rekey(answer, keymap));
      return list;
    },
    [],
  );
  console.log(merge_list);

  return Object.assign(row_answers, ...merge_list);
}

function edit_row(config) {
  let { db_utils, table, row_key, is_new_row } = config;
  is_new_row = undefined_default(is_new_row, true);
  let row = undefined;
  if (is_new_row) {
    row = {};
  } else {
    const rows = db_utils.filtered_rows({
      table,
      restricting_values: row_key,
    });
    if (rows.length !== 1) {
      console.error('sinq error: more than one row found in',
                    table, 'for key', row_key, ':', rows.length);
    }
    row = rows[0];
  }
  const fkrs = db_utils.foreign_key_references(table);
  const { sentinel_ordering, remainder } = separate_sentinels(
    fkrs.size === 0
    ? undefined
    : fkrs.map(
      function (fkr) {
        return fkr.get('from');
      }
    )
  );
  inquirer.prompt(
    db_utils.column_list({ // Is there any case where a rowid_pk column would 
                           // be included in a foreign key reference?
      table,
      exclude_rowid_pks: true,
    }).filter(function (column) {
      return !remainder.has(column.name);
    /*table.columns.filter(function (column) {
      return (
        table.automatic_increment_columns.indexOf(column) === -1
        && !remainder.has(column)
      );*/
    }).map(function (column) {
      const column_name = column.name;
      console.log(column_name);
      if (sentinel_ordering.has(column_name)) {
        const fk_nr = sentinel_ordering.get(column_name);
        const parent_table_name = fkrs.getIn([fk_nr, 'to', 'table']);
        const parent_pk_columns = fkrs.getIn([fk_nr, 'to', 'columns']);
        const child_pk_columns = fkrs.getIn([fk_nr, 'from']);
        const selected_value = rekey(
          pick(row, child_pk_columns.toArray()),
          _.zip(child_pk_columns.toArray(), parent_pk_columns.toArray()),
        );
        console.log('selected_value:', selected_value);
        // This might be better/safer as a more sophisticated object (or just a
        // wrapper function for a prompt config object) that keeps track of the
        // remapping logic internally.  Also, could it depend directly on
        // `db_info.row_choices`, so that it could be moved into this module?
        // I think it might make sense to call it `foreign_key_choices`.
        const choices_info = db_utils.row_choices_info({
          table: parent_table_name,
          value_columns: parent_pk_columns,
          selected_value,
          // TODO: The thing we do below should probably be a utility
          // function (something like `rekey`?) for clarity and unit
          // testing.  Also, I think this is incorrect as written.
          /*restricting_values: Object.entries(answers).reduce(
              function (pk_answers, child_entry, child_column_index) {
            const [ child_column, value ] = child_entry;
            if (child_pk_columns.indexOf(child_column) !== -1) {
              const parent_column = parent_pk_columns.get(
                child_column_index,
              );
              pk_answers[parent_column] = value;
            }
            return pk_answers;
          }, {}),*/
        });
        console.log('selected_index:', choices_info.selected_index, choices_info.choices[choices_info.selected_index]);
        return {
          type: 'search-list',
          name: column_name,
          message: friendly_column_name(column_name),
          default: choices_info.selected_index,
          // choices_info could include a function to use here, if we want to
          // restore using dynamic choices (taking into account previous
          // answers):
          choices: choices_info.choices,
          /*source: function (answers, input = '') {
            return new Promise(function (resolve) {
              resolve(
                choices_info.choices.filter(function (choice) {
                  choice.includes(input);
                })
              );
            });
          },*/
          filter: function (response) {
            return choices_info.choices[response].key
          },
        };
      }
      return {
        type: 'strict-input',
        name: column_name,
        message: friendly_column_name(column_name),
        default: escape(row[column_name]),
        suffix: ''.concat(
          chalk.yellow.dim(' ('.concat(column.type.toLowerCase(), ')')),
          (
            row[column_name] === null
            ? chalk.red.dim(' ('.concat('null', ')'))
            : ''
          ),
        ),
        filter: input_parse,
        transformer: function (input) {
          if (input === null) {
            return chalk.red.dim(input);
          }
          return chalk.cyan(input);
        },
      };
    })
  ).then(function (answers) {
    prompt_check_in({
      db_utils,
      table,
      row: Object.assign(
        row,
        rekey_from_fkrs(answers, fkrs, sentinel_ordering),
      ),
      row_key,
      is_new_row,
    });
  }).catch(function (error) {
    if (error.isTtyError) {
      console.error('Inquirer error: this TTY is not supported.');
    } else {
      console.error('Inquirer error:', error);
    }
  });
}

function prompt_check_in(config) {
  let { db_utils, table, row, row_key, is_new_row } = config;
  inquirer.prompt([
    {
      type: 'expand',
      name: 'action',
      message: 'What would you like to do next?',
      default: 0,
      choices: [
        {
          name: ''.concat(
            'Add ',
            (
              is_new_row
              ? 'another '
              : 'a '
            ),
            'new row',
          ),
          value: 'add',
          key: 'a',
        },
        {
          name: ''.concat(
            'Go back to the top menu (without ',
            (
              is_new_row
              ? 'adding'
              : 'saving'
            ),
            ' this row)',
          ),
          value: 'top',
          key: 't',
        },
        {
          name: ''.concat(
            (
              is_new_row
              ? 'Add'
              : 'Save'
            ),
            ' all [TODO: N] rows added so far (committing this transaction)',
          ),
          value: 'commit',
          key: 'c',
        },
        {
          name: 'Open this row in an editor',
          value: 'open',
          key: 'o',
        },
        {
          name: 'Exit',
          value: 'exit',
          key: 'x',
        },
      ],
    },
    {
      when: function (answers) {
        return answers.action === 'open';
      },
      type: 'editor',
      name: 'edited',
      default: JSON.stringify(row, null, '  '),
    },
  ]).then(function (answers) {
    console.log(table, row, is_new_row, answers);
    if (answers.action === 'commit') {
      if (is_new_row) {
        db_utils.insert(table, row);
      } else {
        db_utils.update(table, row_key, row);
      }
    }
    if (['top', 'commit'].indexOf(answers.action) > -1)
    {
      initial_menu(db_utils); // this strategy just keeps increasing the stack depth, hmmmm... oh, right, not with tail-recursion optimization (I think).
    } else if (answers.action === 'add') {
      edit_row({
        db_utils,
        table,
        row_key: {},
        is_new_row: true,
      });
    } else if (answers.action === 'open') {
      prompt_check_in(config);
    }
  }).catch(function (error) {
    if (error.isTtyError) {
      console.error('Inquirer error: this TTY is not supported.');
    } else {
      console.error('Inquirer error:', error);
    }
  });
}

// What I want to do is craft a function factory that makes "answer" receivers,
// which take an answer from a prompt and then display the next prompt in a
// sort of state machine style.  I'm struggling with how best to conceptualize
// it, though.
//
// Maybe each `prompt_*` function should just return its answers to its
// callers, and we'll assume that the caller will always be able to process
// those answers?  (This would not be a factory model, though.)

function table_options(db_utils, table_name) {
  const columns = db_utils.column_choices(table_name);

  inquirer.prompt([
    {
      type: 'search-list',
      name: 'action',
      message: `What action do you want to take on table '${table_name}'?`,
      choices: [
        {
          name: 'Add a new row',
          value: 'new',
        },
        {
          // TODO: does this only make sense for uniquely-valued columns?
          name: 'Search for rows by column',
          value: 'column_search',
        },
        {
          name: 'Free search for rows',
          value: 'free_search',
        },
      ],
    },
    {
      when: function (current_answer) {
        return current_answer.action === 'column_search';
      },
      type: 'search-list',
      name: 'column_name',
      message: 'Which column do you want to search?',
      choices: columns,
      default: columns[0].value,
    },
    {
      when: function (current_answer) {
        return current_answer.action === 'column_search';
      },
      type: 'search-list',
      name: 'row_key',
      message: function (current_answer) {
        return `Select a value from '${current_answer.column_name}':`;
      },
      choices: function (current_answer) {
        return db_utils.row_choices({
          table: table_name,
          display_columns: [current_answer.column_name],
        });
      },
    },
    {
      when: function (current_answer) {
        return current_answer.action === 'free_search';
      },
      type: 'search-list',
      name: 'row_key',
      prefix: chalk.green(
        `Columns in "${table_name}":`,
        columns.map(function (column) {
          return column.name;
        }).join('; '),
        "\n?",
      ),
      message: function (current_answer) {
        return 'Select a row:';
      },
      choices: function (current_answer) {
        return db_utils.row_choices({ table: table_name });
      },
    },
  ]).then(function (answer) {
    edit_row({
      db_utils,
      table: table_name,
      row_key: answer.row_key,
      is_new_row: answer.action === 'new',
    });
  }).catch(function (error) {
    if (error.isTtyError) {
      console.error('Inquirer error: this TTY is not supported.');
    } else {
      console.error('Inquirer error:', error);
    }
  });
}

function affinity_filter_factory(column) {
  const column_affinity = sqlite3_affinity(column.type);
  if (['integer', 'real', 'numeric'].some(function (affinity) {
        return column_affinity === affinity;
      })) {
    return function filter(value) {
      const number_conversion = _.toNumber(value);
      if (_.isNaN(number_conversion)) {
        return value;
      }
      return number_conversion;
    };
  }
  return function filter(value) {
    return value;
  };
}

export { initial_menu };
