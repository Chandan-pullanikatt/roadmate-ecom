import React from 'react';

const Tag = ({ text, type = "blue" }) => {
  return (
    <span className={`tag tag-${type}`}>
      {text}
    </span>
  );
};

export default Tag;
