import immutable from 'immutable';
import cliTruncate from 'cli-truncate';
import chalk from 'chalk';
import process from 'node:process';

import { pick, undefined_default } from './util.js';

function sqlite3_affinity(type_name) {
  type_name = type_name.toLowerCase();
  function type_name_contains(substring) {
    return type_name !== null && type_name.indexOf(substring) > -1;
  }
  if (type_name_contains('int')) {
    return 'integer';
  }
  if (['char', 'clob', 'text'].some(type_name_contains)) {
    return 'text';
  }
  if (type_name === null || type_name_contains('blob')) {
    return 'blob';
  }
  if (['real', 'floa', 'doub'].some(type_name_contains)) {
    return 'real';
  }
  return 'numeric';
}

// For when you need to build queries from table or column names on the fly:
function escape_identifier(identifier) {
  return ''.concat('"', identifier.replace(/"/, '""'), '"');
}

function get_row_value(config) {
  let { row, value_columns } = config;
  return pick(row, value_columns);
}

// Use e.g. with an insert column list, or a select where clause with `suffix`
// set to ' = ?'
function clause_with_columns(config) {
  const { row_data, separator = ', ', suffix = '' } = config;
  return Object.entries(row_data).reduce(function (result, entry, index) {
      const [ column_name, column_value ] = entry;
      result.sql_clause = result.sql_clause.concat(
        (
          index === 0
          ? ''
          : separator
        ),
        escape_identifier(column_name),
        suffix,
      );
      result.param_list.push(column_value);
      return result;
    },
    {
      sql_clause: '',
      param_list: [],
    },
  );
}

function db_utils(db) {
  const tables_query = db.prepare(`
    select name from pragma_table_list where name not like 'sqlite_%'
  `); // TODO: limit to `type='table'`?
  function table_choices() {
    return tables_query.pluck().all();
  }

  const columns_query = db.prepare(`
    select * from pragma_table_info(?) where pk != ?
  `);
  const exclude_pk_columns_query = db.prepare(`
    select * from pragma_table_info(?) where pk = 0
  `);
  // This returns a list of rows about each column (so if e.g. all you want is
  // a list of column names, you'll need to do some `map`ping from this list).
  function column_list(config) {
    let { table, exclude_rowid_pks = false, exclude_all_pks = false,
          include_only_pks = false } = config;
    /*exclude_rowid_pks = undefined_default(exclude_rowid_pks, false);
    exclude_all_pks = undefined_default(exclude_all_pks, false);
    include_only_pks = undefined_default(include_only_pks, false);*/

    const pk_columns = columns_query.all(table, 0);
    if (exclude_rowid_pks && pk_columns.length === 1) {
      // We could also check to be sure that this one row has pk === 1,
      // but by the SQLite specification it should.
      return columns_query.all(table, 1);
    }
    if (exclude_all_pks) {
      return exclude_pk_columns_query.all(table);
    }
    if (include_only_pks) {
      return pk_columns;
    }
    return columns_query.all(table, -1);
  }

  function column_choices(table) {
    return column_list({
      table,
      //exclude_rowid_pks: true,
    }).map(function (column) {
      return {
        name: column.name,
        value: column.name,
      };
    });
  }

  const foreign_keys_query = db.prepare(`
    select * from pragma_foreign_key_list(?)
  `);
  function foreign_key_references(table) {
    return foreign_keys_query.all(table).reduce(function (list, row) {
      if (!list.has(row.id)) {
        const foreign_key_info = immutable.fromJS({
          from: [],
          to: {
            table: row.table,
            columns: []
          },
        });
        list = list.set(row.id, foreign_key_info)
      }
      list = list.setIn([row.id, 'from', row.seq], row.from);
      return list.setIn([row.id, 'to', 'columns', row.seq], row.to);
    }, immutable.List());
  }

  function sample_row(table, row, columns=undefined) {
    if (columns === undefined) {
      columns = column_list({
        table,
        include_only_pks: true,
      });
    }
    return columns.reduce(function (values, column) {
      values[column] = row[column.name];
      return values;
    }, {});
  }

  // This recursively "expands" foreign key references of a single column.
  // Question: do we want to include primary keys in these summary listings?
  function row_summary(config) {
    let { table, row, columns, table_history = immutable.Set() } = config;

    if (columns === undefined) {
      //columns = immutable.OrderedSet(Object.keys(row));
      columns = immutable.OrderedSet(column_list({
        table,
        //exclude_rowid_pks: true,
      }).map(function (column) {
        return column.name;
      }));
    } else {
      columns = immutable.OrderedSet(columns);
    }
    if (!table_history.has(table)) {
      const fkrs = foreign_key_references(table);
      fkrs.forEach(function (fkr) {
        if (fkr.get('from').size === 1) {
          const from_column = fkr.getIn(['from', 0]);
          if (columns.has(from_column)) {
            const parent_table = fkr.getIn(['to', 'table']);
            const restricting_values = {};
            const rowval = row[from_column];
            if (rowval !== null) {
              restricting_values[fkr.getIn(['to', 'columns', 0])] = rowval;
              row[from_column] = row_summary({
                table: parent_table,
                row: filtered_rows({
                  table: parent_table,
                  restricting_values,
                })[0],
                table_history: table_history.add(table),
              });
              if (table_history.size === 0) {
                row[from_column] = ''.concat(
                  chalk.green(row[from_column]),
                  ' (',
                  rowval,
                  ')',
                );
              }
            }
          }
        }
      });
    }

    return columns.toList().reduce(function (output, column, index) {
      return output.concat(
        (
          index === 0
          ? ''
          : '; '
        ),
        row[column]
      );
    }, '');
  }

  function filtered_rows(config) {
    let { table, restricting_values = {} } = config;
    //restricting_values = undefined_default(restricting_values, {});

    let { sql_clause: where_clause, param_list } = clause_with_columns({
      row_data: restricting_values,
      separator: ' and ',
      suffix: ' = ?',
    });
    if (param_list.length > 0) {
      where_clause = ' where '.concat(where_clause);
    }

    return db.prepare(''.concat(
      'select *',
      /*value_columns.reduce(function (output, column, index) {
        return ''.concat(
          (
            index === 0
            ? ''
            : ', '
          ),
          escape_identifier(column),
        );
      }, ''),*/
      ' from ',
      escape_identifier(table),
      where_clause,
    )).all(param_list);
  }

  function row_choices(config) {
    let { table, value_columns, restricting_values,
          display_columns, } = config;

    const rows = filtered_rows(config);
    if (rows.length === 0) {
      return [
        {
          name: 'No choices available!',
          value: undefined,
        },
      ];
    }
    if (value_columns === undefined) {
      value_columns = column_list({
        table,
        include_only_pks: true,
      }).map(function (column) {
        return column.name;
      });
    }
    return rows.map(function (row) {
      const choice_name = cliTruncate(
        row_summary({
          table,
          row,
          columns: display_columns,
        }).trim().replace(/\n/g, ' '),
        process.stdout.columns - 2,
      );
      const key = pick(row, value_columns);
      return {
        name: choice_name,
        short: choice_name,
        value: key,
      };
    });
  }

  function reference_selection(config) {
    let { table, value_columns, restricting_values,
          display_columns, selected_value } = config;
    if (value_columns === undefined) {
      value_columns = column_list({
        table,
        include_only_pks: true,
      }).map(function (column) {
        return column.name;
      });
    }

    const rows = filtered_rows(config);
    if (rows.length === 0) {
      return [
        {
          name: 'No choices available!',
          value: undefined,
        },
      ];
    }

    // This function returns a list of "special" choices for an Inquirer
    // prompt.  They are special in the sense that they have integer `value`
    // fields and an additional `key` field, which is used to retrieve the
    // foreign key reference from the choice object.  Ideally, we would like to
    // store that key directly in `value`, but currently Inquirer only allows
    // choosing default choices based on scalar values (and in particular the
    // `===` operator), so we have to do this little dance.
    const starting_choices = [
      {
        name: 'No value (null)',
        short: chalk.red.dim('null'),
        value: 0,
        key: null,
      },
    ];

    let selected_index = undefined;
    const choices = rows.map(function (row, choice_index) {
      const offset_index = choice_index + starting_choices.length;
      const choice_name = cliTruncate(
        row_summary({
          table,
          row,
          columns: display_columns,
        }).trim().replace(/\n/g, ' '),
        process.stdout.columns - 2,
      );
      const key = pick(row, value_columns);
      if (immutable.Map(key).equals(immutable.Map(selected_value))) {
        selected_index = offset_index;
      }
      return {
        name: choice_name,
        short: choice_name,
        value: offset_index,
        key,
      };
    });

    return {
      choices: starting_choices.concat(choices),
      selected_index,
    };
  }

  function insert(table, row_data) {
    const { sql_clause: columns_clause, param_list } = clause_with_columns({
      row_data
    });

    return db.prepare(''.concat(
      'insert into ',
      escape_identifier(table),
      ' (',
      columns_clause,
      ') values (',
      Array(param_list.length).fill('?').join(', '),
      ')',
    )).run(param_list);
  }

  function update(table, key, row_data) {
    const { sql_clause: set_clause,
            param_list: set_params } = clause_with_columns({
      row_data,
      suffix: ' = ?',
    });
    const { sql_clause: where_clause,
            param_list: where_params } = clause_with_columns({
      row_data: key,
      separator: ' and ',
      suffix: ' = ?',
    });

    return db.prepare(''.concat(
      'update ',
      escape_identifier(table),
      ' set ',
      set_clause,
      ' where ',
      where_clause,
    )).run(set_params.concat(where_params));
  }

  return Object.freeze({
    table_choices,
    column_list,
    column_choices,
    foreign_key_references,
    filtered_rows,
    row_choices,
    reference_selection,
    insert,
    update,
  });
}

export { sqlite3_affinity, get_row_value, db_utils };
