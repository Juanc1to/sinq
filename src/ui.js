import inquirer from 'inquirer';
import InputPrompt from 'inquirer/lib/prompts/input.js';
import inquirer_search_list from '@Juancito/inquirer-search-list';
import chalk from 'chalk';
import immutable from 'immutable';
import _ from 'lodash';

inquirer.registerPrompt('search-list', inquirer_search_list);

import { pick, undefined_default, separate_sentinels, rekey } from './util.js';
import { sqlite3_affinity } from './db.js';

//const ui = new inquirer.ui.BottomBar();

// The default `InputPrompt` class replaces a `null` default with an empty
// string; this subclass provides the default as-is, specifically to pass
// through default `null` column values.
class StrictInput extends InputPrompt {
  filterInput(input) {
    if (!input) {
      return this.opt.default;
    }
    return input;
  }
}
inquirer.registerPrompt('strict-input', StrictInput);

function general_inquirer_error_handler(error) {
  if (error.isTtyError) {
    console.error('Inquirer error: this TTY is not supported.');
  } else {
    console.error('Inquirer error:', error);
  }
}

function friendly_column_name(column) {
  return column.replace(/_/i, ' ');
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
  // TODO: use a command lookup table
  if (output === '' && prefix === ''
      && _.includes(['null', 'true', 'false', 'empty'], command)) {
    if (command === 'null') {
      return null;
    }
    if (command === 'true') {
      return 1;
    }
    if (command === 'false') {
      return 0;
    }
    if (command === 'empty') {
      return '';
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
      // An answer of `null` corresponds to a NULL in the database, that is, no
      // value, so we continue.
      if (answer === null || !sentinel_ordering.has(column_name)) {
        return list;
      }
      const fk_nr = sentinel_ordering.get(column_name);
      const keymap = _.zip(
        fkrs.getIn([fk_nr, 'to', 'columns']).toArray(),
        fkrs.getIn([fk_nr, 'from']).toArray(),
      );
      list.push(rekey(answer, keymap));
      return list;
    },
    [],
  );

  return Object.assign(row_answers, ...merge_list);
}

function ui(db_utils) {
  let current_table = undefined;
  let edit_table_column_name = undefined;
  const PROMPT_EDIT_MODE = 'prompt';
  const WHOLE_ROW_EDIT_MODE = 'row';
  const PARTICULAR_COLUMN_EDIT_MODE = 'column';
  const TEXT_EDITOR_MODE = 'editor';
  let table_edit_mode = PROMPT_EDIT_MODE;
  // Each entry in the `row_data` List is an object of the form:
  //
  // {
  //   action: 'new', // or 'edit'
  //   row_key, // object mapping columns to values in the key
  //   row: {
  //     'column_name': 'value',
  //   },
  // }
  let row_data = immutable.List();

  function table_options() {
    const columns = db_utils.column_choices(current_table);

    const editing_mode_choices = [
      {
        name: 'Edit the whole row',
        value: WHOLE_ROW_EDIT_MODE,
        key: 'r',
      },
      {
        name: 'Edit a particular column',
        value: PARTICULAR_COLUMN_EDIT_MODE,
        key: 'c',
      },
      {
        name: 'Open the row in a text editor',
        value: TEXT_EDITOR_MODE,
        key: 'o',
      },
    ];

    const prompt = inquirer.prompt([
      {
        //type: 'search-list',
        type: 'expand',
        name: 'action',
        message: `What action do you want to take on table '${current_table}'?`,
        choices: [
          {
            name: 'Choose the mode for working with this table',
            value: 'mode_select',
            key: 'm',
          },
          {
            name: 'Add a new row',
            value: 'new',
            key: 'n',
          },
          {
            // TODO: does this only make sense for uniquely-valued columns?
            name: 'Search for rows by column',
            value: 'column_search',
            key: 'c',
          },
          {
            name: 'Free search for rows',
            value: 'free_search',
            key: 's',
          },
        ],
      },
      {
        when: function (answers) {
          return answers.action === 'mode_select';
        },
        type: 'expand',
        name: 'table_mode',
        message: `Choose a mode for working with this table (${current_table})`,
        choices: [
          {
            name: 'Prompt for options for each row',
            value: PROMPT_EDIT_MODE,
            key: 'p',
          },
        ].concat(editing_mode_choices),
        default: table_edit_mode,
      },
      {
        // TODO: This could allow for selecting a set of columns.
        when: function (answers) {
          return (answers.action === 'mode_select'
                  && answers.table_mode === PARTICULAR_COLUMN_EDIT_MODE);
        },
        type: 'search-list',
        name: 'edit_table_column',
        message: `Select a column from ${current_table}`,
        choices: db_utils.column_list({
          table: current_table,
          exclude_rowid_pks: true,
        }),
      },
      {
        when: function (current_answer) {
          return current_answer.action === 'column_search';
        },
        type: 'search-list',
        name: 'search_column',
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
          return `Select a value from '${current_answer.search_column}':`;
        },
        choices: function (current_answer) {
          return db_utils.row_choices({
            table: current_table,
            display_columns: [current_answer.search_column],
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
          `Columns in "${current_table}":`,
          columns.map(function (column) {
            return column.name;
          }).join('; '),
          "\n?",
        ),
        message: function (current_answer) {
          return 'Select a row:';
        },
        choices: function (current_answer) {
          return db_utils.row_choices({ table: current_table });
        },
      },
      {
        when: function (answers) {
          return (answers.action !== 'mode_select'
                  && table_edit_mode === PROMPT_EDIT_MODE);
        },
        type: 'expand',
        name: 'row_mode',
        message: 'What would you like to do with this row?',
        choices: editing_mode_choices,
        default: table_edit_mode,
      },
      {
        // TODO: This could allow for selecting a set of columns.
        when: function (answers) {
          return (answers.row_mode === PARTICULAR_COLUMN_EDIT_MODE);
        },
        type: 'search-list',
        name: 'edit_row_column',
        message: `Select a column from ${current_table}`,
        choices: db_utils.column_list({
          table: current_table,
          exclude_rowid_pks: true,
        }),
      },
      {
        when: function (answers) {
          if (answers.action !== 'mode_select') {
            const is_new_row = (answers.action === 'new');
            const row_key = answers.row_key;
            row_data = row_data.push({
              action: (
                is_new_row
                ? 'new'
                : 'edit'
              ),
              row_key,
              row: get_row_from_key({
                row_key,
                is_new_row,
              }),
            });
          }
          return ((answers.action !== 'mode_select'
                   && table_edit_mode === TEXT_EDITOR_MODE)
                  || answers.row_mode === TEXT_EDITOR_MODE);
        },
        type: 'editor',
        name: 'edited',
        default: function (answers) {
          return JSON.stringify(row_data.last().row, null, '  ');
        },
      },
    ]);

    prompt.ui = undefined;

    prompt.then(function (answers) {
      if (answers.action === 'mode_select') {
        // Will this have the default value if the prompt is hidden?
        table_edit_mode = answers.table_mode;
        edit_table_column_name = answers.edit_table_column;

        return table_options();
      } else if (answers.edited !== undefined) {
        const last_row_data = row_data.last();
        last_row_data.row = JSON.parse(answers.edited);
        row_data = row_data.set(-1, last_row_data);
        return prompt_check_in();
      } else {
        return edit_row({
          editing_mode: (
            table_edit_mode === PROMPT_EDIT_MODE
            ? answers.row_mode
            : table_edit_mode
          ),
          edit_column: (
            table_edit_mode === PROMPT_EDIT_MODE
            ? answers.edit_row_column
            : edit_table_column_name
          ),
          //row_key: answers.row_key,
          //is_new_row,
        });
      }
    }).catch(general_inquirer_error_handler);
  }

  function get_row_from_key(config) {
    const { row_key, is_new_row = true } = config;
    let row = undefined;
    if (is_new_row) {
      row = {};
    } else {
      const rows = db_utils.filtered_rows({
        table: current_table,
        restricting_values: row_key,
      });
      if (rows.length !== 1) {
        console.error('sinq error: more than one row found in',
                      current_table, 'for key', row_key, ':', rows.length);
      }
      row = rows[0];
    }
    return row;
  }

  function edit_row(config) {
    let { editing_mode, edit_column } = config;

    const row = row_data.last().row;
    const fkrs = db_utils.foreign_key_references(current_table);
    const { sentinel_ordering, remainder } = separate_sentinels(
      fkrs.size === 0
      ? undefined
      : fkrs.map(
        function (fkr) {
          return fkr.get('from');
        }
      )
    );

    const column_list = (
      editing_mode === PARTICULAR_COLUMN_EDIT_MODE
      ? [{ name: edit_column }]
      : db_utils.column_list({ // Is there any case where a rowid_pk column
                               // would be included in a foreign key reference?
          table: current_table,
          exclude_rowid_pks: true,
        }).filter(function (column) {
          return !remainder.has(column.name);
        /*table.columns.filter(function (column) {
          return (
            table.automatic_increment_columns.indexOf(column) === -1
            && !remainder.has(column)
          );}*/
        })
    );
    const prompt = inquirer.prompt(
      column_list.map(function (column) {
        const column_name = column.name;
        if (sentinel_ordering.has(column_name)) {
          const fk_nr = sentinel_ordering.get(column_name);
          const parent_table_name = fkrs.getIn([fk_nr, 'to', 'table']);
          const parent_pk_columns = fkrs.getIn([fk_nr, 'to', 'columns']);
          const child_pk_columns = fkrs.getIn([fk_nr, 'from']);
          const selected_value = rekey(
            pick(row, child_pk_columns.toArray()),
            _.zip(child_pk_columns.toArray(), parent_pk_columns.toArray()),
          );
          // This might be better/safer as a more sophisticated object (or just
          // a wrapper function for a prompt config object) that keeps track of
          // the remapping logic internally.  Also, could it depend directly on
          // `db_info.row_choices`, so that it could be moved into this module?
          // I think it might make sense to call it `foreign_key_choices`.
          const choices_info = db_utils.reference_selection({
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
    );

    prompt.ui = undefined;

    prompt.then(function (answers) {
      const last_row_data = row_data.last();
      last_row_data.row = Object.assign(
        row,
        rekey_from_fkrs(answers, fkrs, sentinel_ordering),
      );
      //last_row_data.row_key = row_key;
      row_data = row_data.set(-1, last_row_data);
      return prompt_check_in();
    }).catch(general_inquirer_error_handler);
  }

  function prompt_check_in() {
    const last_row_is_new = (
      row_data.size > 0 && row_data.last().action === 'new'
    );
    let action_choices = [
      {
        name: 'Continue working on this table',
        value: 'continue',
        key: 'c',
      },
      {
        name: 'Go to the top menu (without saving recent edits)',
        value: 'top',
        key: 't',
      },
      {
        name: 'Exit',
        value: 'exit',
        key: 'x',
      },
    ];
    if (row_data.size > 0) {
      action_choices = [
        {
          name: 'Open this row in a text editor',
          value: 'open',
          key: 'o',
        },
        {
          name: `Save your last (${row_data.size}) edits`,
          value: 'save',
          key: 's',
        },
      ].concat(action_choices);
    }

    const prompt = inquirer.prompt([
      {
        type: 'expand',
        name: 'action',
        message: 'What would you like to do next?',
        default: 0,
        choices: action_choices,
      },
      {
        when: function (answers) {
          return answers.action === 'open';
        },
        type: 'editor',
        name: 'edited',
        default: JSON.stringify(row_data.last({ row: {} }).row, null, '  '),
      },
    ]);

    prompt.ui = undefined;

    prompt.then(function (answers) {
      const last_row_data = row_data.last();
      if (answers.action === 'save') {
        if (last_row_is_new) {
          db_utils.insert(current_table, last_row_data.row);
        } else {
          db_utils.update(
            current_table,
            last_row_data.row_key,
            last_row_data.row,
          );
        }
        row_data = row_data.clear();
        return prompt_check_in();
      }
      if (answers.action === 'top')
      {
        row_data = row_data.clear();
        // This strategy (treating these prompt handlers as continuations?)
        // just keeps increasing the stack depth, hmmmm... oh, right, not with
        // tail call optimization (TCO) (I think).  But I've recently learned
        // that Node.js doesn't implement TCO.  Sad.
        return initial_menu(db_utils);
      } else if (answers.action === 'continue') {
        return table_options();
      } else if (answers.action === 'open') {
        // TODO: make this actually work
        row_data = row_data.pop();
        last_row_data.row = JSON.parse(answers.edited);
        row_data = row_data.push(last_row_data);
        return prompt_check_in();
      }
    }).catch(general_inquirer_error_handler);
  }

  function initial_menu() {
    const prompt = inquirer.prompt({
      type: 'search-list',
      name: 'table',
      message: 'Select a table to examine:',
      choices: db_utils.table_choices(),
    });

    prompt.ui = undefined;

    prompt.then(function (answer) {
      current_table = answer.table;
      return table_options();
    }).catch(general_inquirer_error_handler);
  }

  return Object.freeze({ initial_menu });
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

export { ui }
