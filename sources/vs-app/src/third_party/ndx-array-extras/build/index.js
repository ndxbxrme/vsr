(function() {
  'use strict';
  Array.prototype.remove = function(thing) {
    return this.splice(this.indexOf(thing), 1);
  };

  Array.prototype.moveUp = function(thing) {
    var index;
    index = this.indexOf(thing);
    if (index > 0) {
      this.splice(index, 1);
      return this.splice(index - 1, null, thing);
    }
  };

  Array.prototype.moveDown = function(thing) {
    var index;
    index = this.indexOf(thing);
    if (index > -1 && index < this.length - 1) {
      this.splice(index, 1);
      return this.splice(index + 1, null, thing);
    }
  };

  Array.prototype.moveFirst = function(thing) {
    var index;
    index = this.indexOf(thing);
    if (index > 0) {
      this.splice(index, 1);
      return this.splice(0, null, thing);
    }
  };

  Array.prototype.moveLast = function(thing) {
    var index;
    index = this.indexOf(thing);
    if (index > -1 && index < this.length - 1) {
      this.splice(index, 1);
      return this.splice(this.length, null, thing);
    }
  };

}).call(this);

//# sourceMappingURL=index.js.map
