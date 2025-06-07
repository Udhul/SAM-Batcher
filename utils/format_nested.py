def format_nested_list(data, indent=0, max_depth=16):
    """Format the structure of nested lists/arrays showing dimensions and lengths.
    
    Returns:
        str: Formatted string representation of the nested structure
    """
    if indent > max_depth:
        return "  " * indent + "... (max depth reached)\n"
    
    result = ""
    
    if isinstance(data, (list, tuple)):
        result += "  " * indent + f"List/Tuple (len: {len(data)})\n"
        if len(data) > 0:
            # Show all items if 6 or fewer, otherwise show first 3
            items_to_show = len(data) if len(data) <= 6 else 3
            for i, item in enumerate(data[:items_to_show]):
                result += "  " * indent + f"  [{i}]:\n"
                result += format_nested(item, indent + 2, max_depth)
            if len(data) > 6:
                result += "  " * indent + f"  ... and {len(data) - 3} more items\n"
    elif hasattr(data, 'shape'):  # numpy array
        result += "  " * indent + f"NumPy Array (shape: {data.shape}, dtype: {data.dtype})\n"
    elif hasattr(data, '__len__'):  # other array-like objects
        try:
            result += "  " * indent + f"Array-like (len: {len(data)}, type: {type(data).__name__})\n"
        except:
            result += "  " * indent + f"Object (type: {type(data).__name__})\n"
    else:
        result += "  " * indent + f"Scalar (type: {type(data).__name__}, value: {data})\n"
    
    return result


def format_nested_dict(data, indent=0, max_depth=16):
    """Format the structure of nested dictionaries showing keys and value types.
    
    Returns:
        str: Formatted string representation of the nested structure
    """
    if indent > max_depth:
        return "  " * indent + "... (max depth reached)\n"
    
    result = ""
    
    if isinstance(data, dict):
        result += "  " * indent + f"Dict (len: {len(data)})\n"
        if len(data) > 0:
            # Show all items if 6 or fewer, otherwise show first 3
            items = list(data.items())
            items_to_show = len(items) if len(items) <= 6 else 3
            for i, (key, value) in enumerate(items[:items_to_show]):
                result += "  " * indent + f"  '{key}':\n"
                result += format_nested(value, indent + 2, max_depth)
            if len(data) > 6:
                result += "  " * indent + f"  ... and {len(data) - 3} more items\n"
    elif hasattr(data, 'shape'):  # numpy array
        result += "  " * indent + f"NumPy Array (shape: {data.shape}, dtype: {data.dtype})\n"
    elif hasattr(data, '__len__'):  # other array-like objects
        try:
            result += "  " * indent + f"Array-like (len: {len(data)}, type: {type(data).__name__})\n"
        except:
            result += "  " * indent + f"Object (type: {type(data).__name__})\n"
    else:
        result += "  " * indent + f"Scalar (type: {type(data).__name__}, value: {data})\n"
    
    return result


def format_nested(data, indent=0, max_depth=16):
    """Format the structure of nested data structures (lists, tuples, dicts) showing dimensions and lengths.
    
    This is the main entry point that automatically detects the data type and calls the appropriate formatter.
    
    Args:
        data: The data structure to format (list, tuple, dict, or any other type)
        indent: Current indentation level (default: 0)
        max_depth: Maximum depth to traverse before stopping (default: 10)
    
    Returns:
        str: Formatted string representation of the nested structure
    """
    if indent > max_depth:
        return "  " * indent + "... (max depth reached)\n"
    
    result = ""
    
    if isinstance(data, dict):
        result += "  " * indent + f"Dict (len: {len(data)})\n"
        if len(data) > 0:
            # Show all items if 6 or fewer, otherwise show first 3
            items = list(data.items())
            items_to_show = len(items) if len(items) <= 6 else 3
            for i, (key, value) in enumerate(items[:items_to_show]):
                result += "  " * indent + f"  '{key}':\n"
                result += format_nested(value, indent + 2, max_depth)
            if len(data) > 6:
                result += "  " * indent + f"  ... and {len(data) - 3} more items\n"
    elif isinstance(data, (list, tuple)):
        result += "  " * indent + f"List/Tuple (len: {len(data)})\n"
        if len(data) > 0:
            # Show all items if 6 or fewer, otherwise show first 3
            items_to_show = len(data) if len(data) <= 6 else 3
            for i, item in enumerate(data[:items_to_show]):
                result += "  " * indent + f"  [{i}]:\n"
                result += format_nested(item, indent + 2, max_depth)
            if len(data) > 6:
                result += "  " * indent + f"  ... and {len(data) - 3} more items\n"
    elif hasattr(data, 'shape'):  # numpy array
        result += "  " * indent + f"NumPy Array (shape: {data.shape}, dtype: {data.dtype})\n"
    elif hasattr(data, '__len__'):  # other array-like objects
        try:
            result += "  " * indent + f"Array-like (len: {len(data)}, type: {type(data).__name__})\n"
        except:
            result += "  " * indent + f"Object (type: {type(data).__name__})\n"
    else:
        result += "  " * indent + f"Scalar (type: {type(data).__name__}, value: {data})\n"
    
    return result
