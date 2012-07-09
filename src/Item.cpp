/* 
 * File:   Items.cpp
 * Author: Exiiile
 * 
 * Created on June 20, 2012, 1:52 PM
 */

#include "Item.h"

Item::Item(int x, int y, int c)
    : Drawable(x, y, c)
{
}

Item::Item(int c, TCODColor fore,TCODColor back, bool trans, bool walk)
    : Drawable(c, fore, back, trans, walk)
{
}

Item::Item(int x, int y, int c, TCODColor fore, TCODColor back, bool trans, bool walk)
    : Drawable(x, y, c, fore, back, trans, walk)
{
}

Item::~Item() {
}

