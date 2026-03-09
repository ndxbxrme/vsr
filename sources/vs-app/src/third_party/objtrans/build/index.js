(function() {
  'use strict';
  var objtrans, objtransFilter;

  objtrans = function(input, pattern, output) {
    var bit, bits, e, error, field, func, inField, index, j, len, myInput, type;
    if (!output) {
      output = {};
    }
    for (field in pattern) {
      if (field === 'objtrans-filter') {
        return objtransFilter(input, pattern[field], output);
      }
      func = null;
      type = Object.prototype.toString.call(pattern[field]);
      if (type === '[object Array]') {
        func = pattern[field][1];
        pattern[field] = pattern[field][0];
        type = '[object String]';
      }
      if (type === '[object Function]') {
        func = pattern[field];
        type = '[object Boolean]';
      }
      if (type === '[object Boolean]') {
        output[field] = func ? func(input[field] || input) : input[field];
      } else if (type === '[object Object]') {
        inField = input[field];
        if (inField) {
          if (Object.prototype.toString.call(inField) === '[object Object]') {
            output[field] = objtrans(inField, pattern[field]);
          } else {
            output[field] = func ? func(inField) : inField;
          }
        } else {
          output[field] = objtrans(input, pattern[field]);
        }
      } else if (type === '[object String]') {
        bits = pattern[field].split(/\./g);
        try {
          myInput = JSON.parse(JSON.stringify(input));
        } catch (error) {
          e = error;
          myInput = input;
        }
        for (j = 0, len = bits.length; j < len; j++) {
          bit = bits[j];
          index = -1;
          bit = bit.replace(/\[(.+)\]$|$/, function(all, num) {
            index = num;
            return '';
          });
          if (index && index !== -1) {
            if (index === 'first') {
              index = 0;
            }
            if (index === 'last') {
              index = myInput[bit].length - 1;
            }
            if (myInput[bit]) {
              myInput = myInput[bit][+index];
            }
          } else {
            myInput = myInput[bit];
          }
          if (myInput) {
            output[field] = myInput;
          } else {
            output[field] = void 0;
            break;
          }
        }
        output[field] = func ? func(output[field], field) : output[field];
      }
    }
    return output;
  };

  objtransFilter = function(input, pattern, output) {
    var bit, bits, field, i, j, len, myobj, type;
    output = JSON.parse(JSON.stringify(input));
    for (field in pattern) {
      type = Object.prototype.toString.call(pattern[field]);
      if (type === '[object Object]') {
        output[field] = objtransFilter(input[field], pattern[field]);
      } else if (type === '[object Function]') {
        if (pattern[field](output[field], field)) {
          delete output[field];
        }
      } else {
        if (pattern[field]) {
          bits = field.split(/\./g);
          myobj = output;
          for (i = j = 0, len = bits.length; j < len; i = ++j) {
            bit = bits[i];
            if (myobj[bit]) {
              if (i < bits.length - 1) {
                myobj = myobj[bit];
              } else {
                delete myobj[bit];
              }
            }
          }
        }
      }
    }
    return output;
  };

  this.objtrans = objtrans;

  if (typeof exports === 'object') {
    module.exports = objtrans;
  }

}).call(this);

//# sourceMappingURL=index.js.map
