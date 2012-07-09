/* 
 * File:   Items.cpp
 * Author: Exiiile
 * 
 * Created on June 20, 2012, 1:52 PM
 */

#include "Item.h"

Item::Item(int a, int b, int c, TCODColor d,TCODColor e,bool f,bool g) : Drawable (a,b,c,d,e,f,g) {
}



Item::Item(int c, TCODColor d,TCODColor e,bool f,bool g) : Drawable (c,d,e,f,g) {
     x=0;//temp
     y=8;//temp

}

Item::~Item() {
}

