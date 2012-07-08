/* 
 * File:   Effects.cpp
 * Author: Exiiile
 * 
 * Created on June 20, 2012, 1:53 PM
 */

#include "Effects.h"

Effects::Effects(int x, int y, int c)
    : Drawable(x, y, c)
{
}

Effects::Effects(int c, TCODColor fore,TCODColor back, bool trans, bool walk)
    : Drawable(c, fore, back, trans, walk)
{
}

Effects::Effects(int x, int y, int c, TCODColor fore, TCODColor back, bool trans, bool walk)
    : Drawable(x, y, c, fore, back, trans, walk)
{
}

Effects::~Effects() {
}

